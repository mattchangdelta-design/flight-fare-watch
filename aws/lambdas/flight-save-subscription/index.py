"""flight-save-subscription (POST /subscribe).

M2: a new or unpaid subscription is written as pending_payment and the response is an
auto-submitting ECPay 信用卡定期定額 checkout form (text/html). A paying subscriber
(active, or cancelled but still inside the paid period) only updates the target price
in place and gets JSON back. Only the ECPay callbacks ever set active.
When billing is switched off (common/settings.py), new/unpaid rows are saved as status "free"
and the response is JSON - no checkout. Paying rows are untouched either way.
Any Taiwan origin -> any destination (common/places.py); at most MAX_ROUTES routes per person.
Deployed from S3 together with common/auth.py, common/ecpay.py, common/settings.py and common/places.py."""
import base64, json, os
from decimal import Decimal, InvalidOperation
from html import escape
import boto3
from boto3.dynamodb.conditions import Key
from auth import auth_email, AuthDown
import ecpay
import settings
import places

API = os.environ.get("API_BASE", "https://z3i3apvemd.execute-api.us-east-1.amazonaws.com").strip().rstrip("/")
SITE = os.environ.get("SITE_URL", "https://flight-fare-watch.vercel.app").strip().rstrip("/")
PERIOD_TYPE = os.environ.get("PERIOD_TYPE", "M").strip()  # set "D" briefly to test renewals the next day
MAX_ROUTES = int(os.environ.get("MAX_ROUTES", "2"))  # routes one person may track
T = boto3.resource("dynamodb").Table("subscriptions")


def resp(code, body):
    return {"statusCode": code, "headers": {"content-type": "application/json"},
            "body": json.dumps(body, ensure_ascii=False)}


def paying(it, now_s):
    st = it.get("subscription_status")
    return st == "active" or (st == "cancelled" and it.get("current_period_end", "") >= now_s)


def checkout_page(fields):
    inputs = "".join(f'<input type="hidden" name="{k}" value="{escape(str(v), quote=True)}">'
                     for k, v in fields.items())
    return ('<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1"><title>前往綠界付款</title></head>'
            '<body style="font-family:sans-serif;padding:2rem"><p>正在前往綠界付款頁…</p>'
            f'<form method="post" action="https://{ecpay.host()}/Cashier/AioCheckOut/V5" accept-charset="UTF-8">'
            f'{inputs}<noscript><button type="submit">前往付款</button></noscript></form>'
            '<script>document.forms[0].submit()</script></body></html>')


def handler(e, c):
    try:
        email = auth_email(e)
    except AuthDown:
        return resp(503, {"error": "auth service unavailable"})
    if not email:
        return resp(401, {"error": "sign in required"})
    if len(email) > 50:  # ECPay CustomField1 holds at most 50 characters
        return resp(400, {"error": "email is too long for the payment provider"})
    b = e.get("body") or "{}"
    if e.get("isBase64Encoded"):
        b = base64.b64decode(b).decode()
    try:
        d = json.loads(b) if isinstance(b, str) else b
    except Exception:
        return resp(400, {"error": "invalid JSON"})
    o, dst, err = places.parse_route(d)
    if err:
        return resp(400, {"error": err})
    try:
        tp = Decimal(str(d.get("target_price")))
    except (InvalidOperation, TypeError):
        return resp(400, {"error": "target_price must be a number"})
    if not tp.is_finite() or tp <= 0 or tp > 1000000:
        return resp(400, {"error": "target_price must be a positive TWD amount"})
    tp = tp.quantize(Decimal("1"))
    route = f"{o}-{dst}"
    oname, dname = places.name(o), places.name(dst)
    key = {"email": email, "route": route}
    now = ecpay.now_utc()
    now_s = ecpay.iso(now)
    base = {":o": o, ":d": dst, ":on": oname, ":dn": dname, ":t": tp, ":c": "TWD", ":n": now_s}
    sets = ("origin=:o, destination=:d, origin_name=:on, destination_name=:dn, target_price=:t, "
            "currency=:c, updated_at=:n")

    cur = T.get_item(Key=key).get("Item")
    if not cur:
        mine = T.query(KeyConditionExpression=Key("email").eq(email), ProjectionExpression="route").get("Items", [])
        if len(mine) >= MAX_ROUTES:
            return resp(409, {"error": f"最多只能追蹤 {MAX_ROUTES} 條航線，請先刪除或取消其中一條"})
    if cur and paying(cur, now_s):
        # Already paid for: change the target in place, keep the status and the period.
        T.update_item(Key=key, UpdateExpression="SET " + sets, ExpressionAttributeValues=base)
        return resp(200, {"ok": True, "in_place": True, "email": email, "route": route,
                          "target_price": int(tp), "currency": "TWD",
                          "subscription_status": cur.get("subscription_status"),
                          "current_period_end_date": cur.get("current_period_end_date")})

    if not settings.billing_enabled():
        # Free mode: no checkout. A previous pending/expired/free row just becomes "free".
        T.update_item(Key=key,
            UpdateExpression="SET " + sets + ", created_at=if_not_exists(created_at,:n), subscription_status=:s",
            ExpressionAttributeValues={**base, ":s": "free"})
        print("free subscription", email, route)
        return resp(200, {"ok": True, "free": True, "email": email, "route": route,
                          "target_price": int(tp), "currency": "TWD", "subscription_status": "free"})

    conf = ecpay.cfg()
    amount = str(int(conf["amount"]))
    mtn = "FW" + now.astimezone(ecpay.TW).strftime("%y%m%d%H%M%S") + os.urandom(3).hex()  # 20 chars
    T.update_item(Key=key,
        UpdateExpression="SET " + sets + ", created_at=if_not_exists(created_at,:n), subscription_status=:s, "
                         "merchant_trade_no=:m, period_type=:pt, checkout_at=:n",
        ExpressionAttributeValues={**base, ":s": "pending_payment", ":m": mtn, ":pt": PERIOD_TYPE})
    fields = {
        "MerchantID": conf["merchant_id"],
        "MerchantTradeNo": mtn,
        "MerchantTradeDate": now.astimezone(ecpay.TW).strftime("%Y/%m/%d %H:%M:%S"),
        "PaymentType": "aio",
        "TotalAmount": amount,
        "TradeDesc": "Flight fare watch monthly plan",
        "ItemName": f"機票降價通知 {oname}-{dname} 月費"[:200],
        "ReturnURL": API + "/ecpay-return",
        "OrderResultURL": API + "/ecpay-result",
        "ClientBackURL": SITE + "/app",
        "ChoosePayment": "Credit",
        "EncryptType": "1",
        "PeriodAmount": amount,
        "PeriodType": PERIOD_TYPE,
        "Frequency": "1",
        "ExecTimes": "999" if PERIOD_TYPE == "M" else "2",
        "PeriodReturnURL": API + "/ecpay-period",
        "CustomField1": email,
        "CustomField2": route,
    }
    fields["CheckMacValue"] = ecpay.cmv(fields)
    print("checkout", email, route, mtn, PERIOD_TYPE, amount)
    return {"statusCode": 200, "headers": {"content-type": "text/html; charset=utf-8", "cache-control": "no-store"},
            "body": checkout_page(fields)}
