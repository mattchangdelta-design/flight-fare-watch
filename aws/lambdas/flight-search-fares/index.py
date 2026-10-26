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
import places  # common/places.py, zipped alongside
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
def arrive(dep_iso, minutes, tz_iso):
    """Arrival time in the arrival city's offset, taken from a timestamp that departs from that city
    (outbound arrival -> the return departure's offset; return arrival -> the outbound departure's)."""
    if not dep_iso or not minutes or not tz_iso:
        return None
    t = datetime.datetime.fromisoformat(dep_iso) + datetime.timedelta(minutes=minutes)
    return t.astimezone(datetime.datetime.fromisoformat(tz_iso).tzinfo).isoformat()
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
    o, d, err = places.parse_route(q)
    if err:
        return resp(400, {"error": err})
    route = f"{o}-{d}"
    try:
        d1 = datetime.date.fromisoformat(q["date_from"])
        d2 = datetime.date.fromisoformat(q["date_to"])
        t1, t2 = hhmm(q.get("time_from", "00:00")), hhmm(q.get("time_to", "23:59"))
    except Exception:
        return resp(400, {"error": "date_from/date_to must be YYYY-MM-DD, time_from/time_to HH:MM"})
    if d2 < d1 or (d2 - d1).days > MAX_DAYS:
        return resp(400, {"error": f"date range must be 1-{MAX_DAYS} days"})
    # Optional return-leg filters: trip length in days (by local calendar date) and return departure window.
    try:
        n1 = int(q["trip_min"]) if q.get("trip_min") else None
        n2 = int(q["trip_max"]) if q.get("trip_max") else None
        rt1 = hhmm(q["ret_time_from"]) if q.get("ret_time_from") else None
        rt2 = hhmm(q["ret_time_to"]) if q.get("ret_time_to") else None
    except Exception:
        return resp(400, {"error": "trip_min/trip_max must be whole days, ret_time_from/ret_time_to HH:MM"})
    if (n1 is not None and n1 < 0) or (n1 is not None and n2 is not None and n2 < n1):
        return resp(400, {"error": "trip length range is invalid"})
    need_return = any(v is not None for v in (n1, n2, rt1, rt2))
    rows, errors = [], 0
    for m in months(d1, d2):
        try:
            rows += fetch_month(o, d, m)
        except Exception as ex:
            errors += 1
            print("travelpayouts error", m, type(ex).__name__, getattr(ex, "code", ""))
    # Check every fare against each active filter in order, so the site can show where results drop
    # off (the funnel) and offer fares that miss exactly one condition (near misses).
    stages = ["dates"] + (["dep_time"] if (t1, t2) != (0, 23 * 60 + 59) else []) \
        + (["nights"] if (n1, n2) != (None, None) else []) + (["ret_time"] if (rt1, rt2) != (None, None) else [])
    seen, matched, near = set(), [], []
    funnel = {k: 0 for k in stages}
    total = 0
    for r in sorted(rows, key=lambda x: x.get("price", 1e12)):
        dep = r.get("departure_at")
        if not dep:
            continue
        key = (dep, r.get("return_at"), r.get("airline"), r.get("flight_number"))
        if key in seen:
            continue
        seen.add(key)
        total += 1
        dt = datetime.datetime.fromisoformat(dep)
        mins = dt.hour * 60 + dt.minute
        ret = r.get("return_at")
        rdt = datetime.datetime.fromisoformat(ret) if ret else None
        ok = {"dates": d1 <= dt.date() <= d2, "dep_time": t1 <= mins <= t2}
        if rdt:
            days = (rdt.date() - dt.date()).days
            rmins = rdt.hour * 60 + rdt.minute
            ok["nights"] = not ((n1 is not None and days < n1) or (n2 is not None and days > n2))
            ok["ret_time"] = not ((rt1 is not None and rmins < rt1) or (rt2 is not None and rmins > rt2))
        else:
            ok["nights"] = ok["ret_time"] = False
        failed = [k for k in stages if not ok[k]]
        for k in stages:  # cumulative: passes this stage and all earlier ones
            if ok[k]:
                funnel[k] += 1
            else:
                break
        if not failed:
            matched.append(r)
        elif len(failed) == 1:
            near.append((failed[0], r))

    def fare(r, miss=None):
        dep = r.get("departure_at")
        f = {"price": r.get("price"), "airline": r.get("airline"), "flight_number": r.get("flight_number"),
             "origin_airport": r.get("origin_airport"), "destination_airport": r.get("destination_airport"),
             "departure_at": dep, "arrival_at": arrive(dep, r.get("duration_to"), r.get("return_at")),
             "return_at": r.get("return_at"), "return_arrival_at": arrive(r.get("return_at"), r.get("duration_back"), dep),
             "transfers": r.get("transfers"), "return_transfers": r.get("return_transfers"),
             "link": ("https://www.aviasales.com" + r["link"]) if r.get("link") else None}
        if miss:
            f["miss"] = miss
        return f

    out = [fare(r) for r in matched[:10]]
    near_out = [fare(r, k) for k, r in near[:5]] if len(out) < 5 else []
    print("search", route, d1, d2, q.get("time_from"), q.get("time_to"), "trip", n1, n2,
          "ret", q.get("ret_time_from"), q.get("ret_time_to"), "raw", len(rows), "unique", total, "funnel", funnel, "matched", len(out), "near", len(near_out))
    return resp(200, {"route": route, "origin_name": places.name(o), "destination_name": places.name(d), "currency": "TWD", "scanned": total, "results": out,
                      "funnel": [{"stage": "total", "count": total}] + [{"stage": k, "count": funnel[k]} for k in stages],
                      "near": near_out, "months": months(d1, d2), "partial": errors > 0})
