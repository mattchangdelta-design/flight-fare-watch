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
import datetime, urllib.parse
PLANS = {"tokyo": ("TPE", "TYO"), "seoul": ("TPE", "SEL")}
TZ = {"TPE": 8, "TYO": 9, "SEL": 9}  # city UTC offsets (no DST on these routes)
MAX_DAYS = 92
_tp = None
def resp(code, body):
    return {"statusCode": code, "headers": {"content-type": "application/json"}, "body": json.dumps(body, ensure_ascii=False)}
def tp_token():
    global _tp
    if _tp is None:
        _tp = json.loads(boto3.client("secretsmanager").get_secret_value(SecretId="flight/travelpayouts")["SecretString"])["token"]
    return _tp
def months(d1, d2):
    m, out = d1.replace(day=1), []
    while m <= d2:
        out.append(m.strftime("%Y-%m"))
        m = (m + datetime.timedelta(days=32)).replace(day=1)
    return out
def fetch_month(o, d, month):
    q = urllib.parse.urlencode({"origin": o, "destination": d, "departure_at": month, "one_way": "false",
                                "currency": "twd", "sorting": "price", "limit": 1000})
    req = urllib.request.Request("https://api.travelpayouts.com/aviasales/v3/prices_for_dates?" + q,
        headers={"X-Access-Token": tp_token(), "User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as r:
        body = json.loads(r.read())
    return (body.get("data") or []) if body.get("success") else []
def arrive(dep_iso, minutes, city):
    if not dep_iso or not minutes:
        return None
    t = datetime.datetime.fromisoformat(dep_iso) + datetime.timedelta(minutes=minutes)
    return t.astimezone(datetime.timezone(datetime.timedelta(hours=TZ.get(city, 0)))).isoformat()
def hhmm(s):
    h, m = s.split(":")
    return int(h) * 60 + int(m)
def handler(e, c):
    # Direct (IAM-authorized) invokes have no requestContext; API Gateway calls always do.
    try:
        if "requestContext" in e and not auth_email(e):
            return resp(401, {"error": "sign in required"})
    except AuthDown:
        return resp(503, {"error": "auth service unavailable"})
    q = e.get("queryStringParameters") or {}
    plan = q.get("plan_name")
    if plan not in PLANS:
        return resp(400, {"error": "plan_name must be tokyo or seoul"})
    try:
        d1 = datetime.date.fromisoformat(q["date_from"])
        d2 = datetime.date.fromisoformat(q["date_to"])
        t1, t2 = hhmm(q.get("time_from", "00:00")), hhmm(q.get("time_to", "23:59"))
    except Exception:
        return resp(400, {"error": "date_from/date_to must be YYYY-MM-DD, time_from/time_to HH:MM"})
    if d2 < d1 or (d2 - d1).days > MAX_DAYS:
        return resp(400, {"error": f"date range must be 1-{MAX_DAYS} days"})
    o, d = PLANS[plan]
    rows, errors = [], 0
    for m in months(d1, d2):
        try:
            rows += fetch_month(o, d, m)
        except Exception as ex:
            errors += 1
            print("travelpayouts error", m, type(ex).__name__, getattr(ex, "code", ""))
    seen, out = set(), []
    for r in sorted(rows, key=lambda x: x.get("price", 1e12)):
        dep = r.get("departure_at")
        if not dep:
            continue
        dt = datetime.datetime.fromisoformat(dep)
        mins = dt.hour * 60 + dt.minute
        if not (d1 <= dt.date() <= d2 and t1 <= mins <= t2):
            continue
        key = (dep, r.get("return_at"), r.get("airline"), r.get("flight_number"))
        if key in seen:
            continue
        seen.add(key)
        out.append({"price": r.get("price"), "airline": r.get("airline"), "flight_number": r.get("flight_number"),
            "origin_airport": r.get("origin_airport"), "destination_airport": r.get("destination_airport"),
            "departure_at": dep, "arrival_at": arrive(dep, r.get("duration_to"), d),
            "return_at": r.get("return_at"), "return_arrival_at": arrive(r.get("return_at"), r.get("duration_back"), o),
            "transfers": r.get("transfers"), "return_transfers": r.get("return_transfers"),
            "link": ("https://www.aviasales.com" + r["link"]) if r.get("link") else None})
        if len(out) == 10:
            break
    print("search", plan, d1, d2, q.get("time_from"), q.get("time_to"), "raw", len(rows), "matched", len(out))
    return resp(200, {"plan_name": plan, "currency": "TWD", "scanned": len(rows), "results": out,
                      "partial": errors > 0})
