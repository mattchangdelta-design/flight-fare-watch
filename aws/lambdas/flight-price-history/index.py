"""flight-price-history (GET /history?route=TPE-TYO&days=30): the trend chart on a tracking card.

Returns the points flight-parser recorded in price_history for the signed-in user's subscription
(sub = email#route), oldest first: {t, price|null, count, key, cond, depart, ret, airline}.
price is null when nothing matched the conditions at that check (the chart shows a gap).
Sign-in required for API Gateway calls; direct IAM invokes (no requestContext) pass "email" for ops.
Deployed from S3 together with common/auth.py and common/places.py."""
import datetime, json
import boto3
from boto3.dynamodb.conditions import Key
from auth import auth_email, AuthDown
import places

_hist = boto3.resource("dynamodb").Table("price_history")
MAX_DAYS = 180


def resp(code, body):
    return {"statusCode": code, "headers": {"content-type": "application/json"},
            "body": json.dumps(body, ensure_ascii=False)}


def handler(e, c):
    q = e.get("queryStringParameters") or {}
    try:
        email = auth_email(e) if "requestContext" in e else e.get("email")
    except AuthDown:
        return resp(503, {"error": "auth service unavailable"})
    if not email:
        return resp(401, {"error": "sign in required"})
    o, d, err = places.parse_route(q if "requestContext" in e else {**q, **e})
    if err:
        return resp(400, {"error": err})
    try:
        days = max(1, min(MAX_DAYS, int(q.get("days") or e.get("days") or 30)))
    except ValueError:
        return resp(400, {"error": "days must be a number"})
    route = f"{o}-{d}"
    since = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    kce = Key("sub").eq(f"{email}#{route}") & Key("t").gte(since)
    items, kw = [], {}
    while True:
        r = _hist.query(KeyConditionExpression=kce, **kw)
        items += r.get("Items", [])
        if "LastEvaluatedKey" not in r:
            break
        kw["ExclusiveStartKey"] = r["LastEvaluatedKey"]
    points = [{"t": it["t"], "price": int(it["price"]) if it.get("price") is not None else None,
               "count": int(it.get("count", 0)), "key": it.get("key", ""), "cond": it.get("cond", ""),
               "depart": it.get("depart") or None, "ret": it.get("ret") or None,
               "airline": it.get("airline") or None} for it in items]
    return resp(200, {"route": route, "days": days, "points": points})
