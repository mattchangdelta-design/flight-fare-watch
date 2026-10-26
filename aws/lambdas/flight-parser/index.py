"""flight-parser: one route per invocation. Fetch next month's cheapest fare
(TWD = gate, USD = best-effort) and enqueue every subscriber whose target is met."""
import os, json, datetime, urllib.request, urllib.parse, urllib.error
from decimal import Decimal
import boto3
from boto3.dynamodb.conditions import Attr
import settings  # common/settings.py, zipped alongside

UA = "Mozilla/5.0 (compatible; flight-notifier/1.0)"
_sm = boto3.client("secretsmanager")
_sqs = boto3.client("sqs")
_table = boto3.resource("dynamodb").Table("subscriptions")
QURL = os.environ["QUEUE_URL"]
_token = None


def token():
    global _token
    if _token is None:
        _token = json.loads(_sm.get_secret_value(SecretId="flight/travelpayouts")["SecretString"])["token"]
    return _token


def next_month():
    t = datetime.date.today().replace(day=1)
    return (t + datetime.timedelta(days=32)).strftime("%Y-%m")


def fetch_cheapest(origin, destination, month, tok, currency):
    q = urllib.parse.urlencode({"origin": origin, "destination": destination,
                                "depart_date": month, "currency": currency})
    req = urllib.request.Request(f"https://api.travelpayouts.com/v1/prices/cheap?{q}",
        headers={"User-Agent": UA, "Accept": "application/json", "X-Access-Token": tok})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            body = json.loads(r.read())
    except urllib.error.HTTPError as ex:
        print("travelpayouts HTTP", ex.code, currency, origin, destination)
        return None
    except Exception as ex:
        print("travelpayouts error", type(ex).__name__, currency)
        return None
    if not body.get("success") or not body.get("data"):
        return None
    offers = body["data"].get(destination, {})
    if not offers:
        return None
    # offers are keyed by number of transfers ("0" = direct)
    k, best = min(offers.items(), key=lambda kv: kv[1]["price"])
    return {"price": best["price"], "currency": currency.upper(), "airline": best.get("airline"),
            "flight_number": best.get("flight_number"), "transfers": int(k) if str(k).isdigit() else None,
            "depart_date": best.get("departure_at"), "return_date": best.get("return_at")}


def subscribers(route):
    kw = {"FilterExpression": Attr("route").eq(route)}
    while True:
        r = _table.scan(**kw)
        yield from r.get("Items", [])
        if "LastEvaluatedKey" not in r:
            return
        kw["ExclusiveStartKey"] = r["LastEvaluatedKey"]


def gate(it, now):
    """M2 paywall: serve active rows and cancelled rows still inside the paid period;
    retire cancelled rows whose period has ended. pending_payment/expired/legacy are skipped."""
    st = it.get("subscription_status")
    if st == "active":
        return True
    if st == "cancelled":
        if it.get("current_period_end", "") >= now:
            return True
        try:
            _table.update_item(Key={"email": it["email"], "route": it["route"]},
                UpdateExpression="SET subscription_status=:x, expired_at=:n",
                ConditionExpression="subscription_status=:c AND current_period_end < :n",
                ExpressionAttributeValues={":x": "expired", ":c": "cancelled", ":n": now})
            print("expired (grace over)", it["email"], it["route"])
        except _table.meta.client.exceptions.ConditionalCheckFailedException:
            pass
    return False


def handler(event, context):
    origin, destination = event["origin"], event["destination"]
    route = event.get("route") or f"{origin}-{destination}"
    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    billing = settings.billing_enabled()
    # gate() always runs so lapsed cancelled rows still flip to expired; with billing off everyone is served.
    subs = [it for it in subscribers(route) if gate(it, now) or not billing]
    if not subs:
        print(route, "no paying subscribers - skipping" if billing else "no subscribers - skipping")
        return {"ok": True, "route": route, "matched": 0}
    month = next_month()
    tok = token()
    tw = fetch_cheapest(origin, destination, month, tok, "twd")
    if not tw:
        print("no TWD fare for", route, month, "(empty/429) - skipping")
        return {"ok": True, "route": route, "matched": 0}
    print(route, month, "cheapest", json.dumps(tw), "served", len(subs), "billing", billing)
    us = fetch_cheapest(origin, destination, month, tok, "usd")  # may be None - never block on it
    matched = 0
    for it in subs:
        tp = Decimal(str(it["target_price"]))
        if tp < Decimal(str(tw["price"])):
            continue
        body = {"email": it["email"], "route": route, "plan_name": it.get("plan_name"),
                "target_price": int(tp), "cheapest": tw}
        if us:
            body["cheapest_usd"] = us
        _sqs.send_message(QueueUrl=QURL, MessageBody=json.dumps(body))
        matched += 1
    print(route, "matched", matched)
    return {"ok": True, "route": route, "price": tw["price"], "matched": matched}
