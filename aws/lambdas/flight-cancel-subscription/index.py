"""flight-cancel-subscription (POST /cancel, body {"plan_name"}).

Stops future charges with ECPay CreditCardPeriodAction Action=Cancel, then marks the row
cancelled while keeping current_period_end: the subscriber keeps getting alerts until the
period they paid for ends (the parser expires the row afterwards). Queues the cancel email.
Deployed from S3 together with common/auth.py and common/ecpay.py."""
import base64, json, os, time, urllib.parse, urllib.request
import boto3
from botocore.exceptions import ClientError
from auth import auth_email, AuthDown, UA
import ecpay

PLANS = {"tokyo": "TPE-TYO", "seoul": "TPE-SEL"}
T = boto3.resource("dynamodb").Table("subscriptions")
SQS = boto3.client("sqs")
QURL = os.environ["STATUS_QUEUE_URL"]
GONE = {"90100149": "already terminated at ECPay", "90100150": "order not found at ECPay"}


def resp(code, body):
    return {"statusCode": code, "headers": {"content-type": "application/json"},
            "body": json.dumps(body, ensure_ascii=False)}


def ecpay_cancel(mtn):
    conf = ecpay.cfg()
    p = {"MerchantID": conf["merchant_id"], "MerchantTradeNo": mtn, "Action": "Cancel",
         "TimeStamp": str(int(time.time()))}
    p["CheckMacValue"] = ecpay.cmv(p)
    req = urllib.request.Request(f"https://{ecpay.host()}/Cashier/CreditCardPeriodAction",
                                 data=urllib.parse.urlencode(p).encode(), method="POST",
                                 headers={"Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA})
    with urllib.request.urlopen(req, timeout=10) as r:
        raw = r.read().decode("utf-8", "replace")
    out = {k: v[0] for k, v in urllib.parse.parse_qs(raw, keep_blank_values=True).items()}
    if "CheckMacValue" in out and not ecpay.cmv_ok(out):
        print("WARNING CreditCardPeriodAction reply failed CheckMacValue", mtn)
    return out.get("RtnCode", ""), out.get("RtnMsg", raw[:200])


def handler(e, c):
    try:
        email = auth_email(e)
    except AuthDown:
        return resp(503, {"error": "auth service unavailable"})
    if not email:
        return resp(401, {"error": "sign in required"})
    b = e.get("body") or "{}"
    if e.get("isBase64Encoded"):
        b = base64.b64decode(b).decode()
    try:
        plan = json.loads(b).get("plan_name")
    except Exception:
        return resp(400, {"error": "invalid JSON"})
    if plan not in PLANS:
        return resp(400, {"error": "plan_name must be tokyo or seoul"})
    key = {"email": email, "route": PLANS[plan]}
    it = T.get_item(Key=key).get("Item")
    if not it:
        return resp(404, {"error": "找不到這個訂閱"})
    st = it.get("subscription_status")
    if st == "cancelled":
        return resp(200, {"ok": True, "subscription_status": "cancelled",
                          "current_period_end_date": it.get("current_period_end_date")})
    if st != "active":
        return resp(409, {"error": "只有付費中的訂閱可以取消"})

    mtn = it.get("merchant_trade_no")
    if mtn:
        try:
            code, msg = ecpay_cancel(mtn)
        except Exception as ex:
            print("CreditCardPeriodAction error", mtn, type(ex).__name__, ex)
            return resp(502, {"error": "無法連線綠界，請稍後再試"})
        print("CreditCardPeriodAction", mtn, code, msg)
        if code != "1" and code not in GONE:
            return resp(502, {"error": f"綠界取消失敗：{msg}（{code}）"})
        if code in GONE:
            print("cancelling locally:", GONE[code])
    else:
        print("WARNING active row without merchant_trade_no; cancelling locally", email, key["route"])

    now = ecpay.now_utc()
    end_s = it.get("current_period_end") or ecpay.iso(ecpay.add_period(now, "M", 1))  # pre-M2 rows: grant a month
    end_date = ecpay.local_date(ecpay.parse_iso(end_s))
    try:
        T.update_item(Key=key, ConditionExpression="subscription_status = :a",
            UpdateExpression="SET subscription_status=:c, cancelled_at=:n, current_period_end=:e, "
                             "current_period_end_date=:ed",
            ExpressionAttributeValues={":a": "active", ":c": "cancelled", ":n": ecpay.iso(now),
                                       ":e": end_s, ":ed": end_date})
    except ClientError as ex:
        if ex.response["Error"]["Code"] != "ConditionalCheckFailedException":
            raise
        return resp(409, {"error": "訂閱狀態已變更，請重新整理"})
    SQS.send_message(QueueUrl=QURL, MessageBody=json.dumps({
        "event_type": "cancel", "email": email, "route": key["route"], "merchant_trade_no": mtn or "",
        "current_period_end_date": end_date}, ensure_ascii=False))
    print("cancelled", email, key["route"], mtn, "service until", end_s)
    return resp(200, {"ok": True, "subscription_status": "cancelled", "current_period_end": end_s,
                      "current_period_end_date": end_date})
