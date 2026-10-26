import boto3, json, base64, datetime
from decimal import Decimal, InvalidOperation
PLANS = {"tokyo": ("TPE", "TYO"), "seoul": ("TPE", "SEL")}
T = boto3.resource("dynamodb").Table("subscriptions")
def resp(code, body):
    return {"statusCode": code, "headers": {"content-type": "application/json"}, "body": json.dumps(body, ensure_ascii=False)}
def handler(e, c):
    b = e.get("body") or "{}"
    if e.get("isBase64Encoded"):
        b = base64.b64decode(b).decode()
    try:
        d = json.loads(b) if isinstance(b, str) else b
    except Exception:
        return resp(400, {"error": "invalid JSON"})
    email = str(d.get("email", "")).strip().lower()
    plan = d.get("plan_name")
    if "@" not in email or len(email) > 254:
        return resp(400, {"error": "invalid email"})
    if plan not in PLANS:
        return resp(400, {"error": "plan_name must be tokyo or seoul"})
    try:
        tp = Decimal(str(d.get("target_price")))
    except (InvalidOperation, TypeError):
        return resp(400, {"error": "target_price must be a number"})
    if not tp.is_finite() or tp <= 0 or tp > 1000000:
        return resp(400, {"error": "target_price must be a positive TWD amount"})
    tp = tp.quantize(Decimal("1"))
    o, dst = PLANS[plan]
    route = f"{o}-{dst}"
    now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
    T.update_item(Key={"email": email, "route": route},
        UpdateExpression="SET plan_name=:p, origin=:o, destination=:d, target_price=:t, currency=:c, updated_at=:n, created_at=if_not_exists(created_at,:n)",
        ExpressionAttributeValues={":p": plan, ":o": o, ":d": dst, ":t": tp, ":c": "TWD", ":n": now})
    return resp(200, {"ok": True, "email": email, "route": route, "plan_name": plan, "target_price": int(tp), "currency": "TWD"})
