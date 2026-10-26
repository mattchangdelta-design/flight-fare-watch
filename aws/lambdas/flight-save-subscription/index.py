import base64, datetime
from decimal import Decimal, InvalidOperation
import boto3, json, time, urllib.request, urllib.error
UA = "Mozilla/5.0 (compatible; flight-notifier/1.0)"
_sb = None
_cache = {}
class AuthDown(Exception):
    pass
def _supabase():
    global _sb
    if _sb is None:
        s = json.loads(boto3.client("secretsmanager").get_secret_value(SecretId="flight/supabase")["SecretString"])
        _sb = (s["url"].rstrip("/"), s.get("publishable_key") or s.get("anon_key"))
    return _sb
def auth_email(e):
    """Email of the signed-in Supabase user, from the Bearer token; None if missing/invalid."""
    h = (e.get("headers") or {}).get("authorization", "")
    if not h.lower().startswith("bearer "):
        return None
    tok = h[7:].strip()
    hit = _cache.get(tok)
    if hit and hit[1] > time.time():
        return hit[0]
    url, key = _supabase()
    req = urllib.request.Request(url + "/auth/v1/user", headers={"Authorization": "Bearer " + tok, "apikey": key, "User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            u = json.loads(r.read())
    except urllib.error.HTTPError as ex:
        if ex.code >= 500:
            raise AuthDown()
        return None
    except Exception:
        raise AuthDown()
    email = (u.get("email") or "").strip().lower()
    if not email:
        return None
    _cache[tok] = (email, time.time() + 300)
    return email
PLANS = {"tokyo": ("TPE", "TYO"), "seoul": ("TPE", "SEL")}
T = boto3.resource("dynamodb").Table("subscriptions")
def resp(code, body):
    return {"statusCode": code, "headers": {"content-type": "application/json"}, "body": json.dumps(body, ensure_ascii=False)}
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
        d = json.loads(b) if isinstance(b, str) else b
    except Exception:
        return resp(400, {"error": "invalid JSON"})
    plan = d.get("plan_name")
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
