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
PLANS = {"tokyo": "TPE-TYO", "seoul": "TPE-SEL"}
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
    plan = (e.get("queryStringParameters") or {}).get("plan_name")
    if plan not in PLANS:
        return resp(400, {"error": "plan_name must be tokyo or seoul"})
    key = {"email": email, "route": PLANS[plan]}
    it = T.get_item(Key=key).get("Item") or {}
    st = it.get("subscription_status")
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    if st == "active" or (st == "cancelled" and it.get("current_period_end", "") >= now):
        return resp(409, {"error": "付費中的訂閱請先取消訂閱"})
    T.delete_item(Key=key)
    return resp(200, {"ok": True, "email": email, "route": PLANS[plan], "deleted": True})
