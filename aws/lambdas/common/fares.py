"""Fare data + search conditions shared by flight-search-fares (the site's 查詢) and flight-parser
(the alerts), so both judge "does this fare match" exactly the same way.

A condition set is a dict of strings (also how it is stored on a subscription row as `conditions`):
  date_from, date_to   YYYY-MM-DD, departure date range (Taiwan-local calendar), at most MAX_DAYS apart
  time_from, time_to   HH:MM, departure time window (origin-local); default 00:00-23:59
  trip_min, trip_max   optional whole nights away (return date - departure date, local calendars)
  ret_time_from/_to    optional return departure time window (destination-local)
Rows without conditions (tracked before conditions existed) mean "next month, any time"."""
import datetime, json, re, urllib.parse, urllib.request
import boto3

UA = "Mozilla/5.0 (compatible; flight-notifier/1.0)"
TW = datetime.timezone(datetime.timedelta(hours=8))
MAX_DAYS = 92
STAGES = ("dates", "dep_time", "nights", "ret_time")
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_TIME = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
_tp = None


def tp_token():
    global _tp
    if _tp is None:
        _tp = json.loads(boto3.client("secretsmanager").get_secret_value(SecretId="flight/travelpayouts")["SecretString"])["token"]
    return _tp


def today_tw():
    return datetime.datetime.now(TW).date()


def months(d1, d2):
    m, out = d1.replace(day=1), []
    while m <= d2:
        out.append(m.strftime("%Y-%m"))
        m = (m + datetime.timedelta(days=32)).replace(day=1)
    return out


def fetch_month(o, d, month, currency="twd"):
    """Round-trip fares departing in `month` (YYYY-MM) from Travelpayouts' 48-hour search cache."""
    q = urllib.parse.urlencode({"origin": o, "destination": d, "departure_at": month, "one_way": "false",
                                "currency": currency, "sorting": "price", "limit": 1000})
    req = urllib.request.Request("https://api.travelpayouts.com/aviasales/v3/prices_for_dates?" + q,
                                 headers={"X-Access-Token": tp_token(), "User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as r:
        body = json.loads(r.read())
    return (body.get("data") or []) if body.get("success") else []


def hhmm(s):
    h, m = s.split(":")
    return int(h) * 60 + int(m)


def legacy_conditions(today=None):
    """What a row without conditions means: the whole of next month, any time, any length."""
    t = (today or today_tw()).replace(day=1)
    first = (t + datetime.timedelta(days=32)).replace(day=1)
    last = (first + datetime.timedelta(days=32)).replace(day=1) - datetime.timedelta(days=1)
    return {"date_from": first.isoformat(), "date_to": last.isoformat()}


def parse_conditions(src):
    """Normalized condition dict, or (None, error). Accepts the query-string / JSON shape above."""
    src = src or {}
    c = {}
    for k in ("date_from", "date_to"):
        v = str(src.get(k) or "").strip()
        if not _DATE.match(v):
            return None, f"{k} must be YYYY-MM-DD"
        c[k] = v
    try:
        d1, d2 = datetime.date.fromisoformat(c["date_from"]), datetime.date.fromisoformat(c["date_to"])
    except ValueError:
        return None, "invalid date"
    if d2 < d1 or (d2 - d1).days > MAX_DAYS:
        return None, f"date range must be 1-{MAX_DAYS} days"
    for k, default in (("time_from", "00:00"), ("time_to", "23:59"), ("ret_time_from", None), ("ret_time_to", None)):
        v = str(src.get(k) or "").strip()
        if not v:
            if default:
                c[k] = default
            continue
        if not _TIME.match(v):
            return None, f"{k} must be HH:MM"
        c[k] = v
    if c["time_to"] < c["time_from"]:
        return None, "time_to must be after time_from"
    if "ret_time_from" in c and "ret_time_to" in c and c["ret_time_to"] < c["ret_time_from"]:
        return None, "ret_time_to must be after ret_time_from"
    for k in ("trip_min", "trip_max"):
        v = str(src.get(k) or "").strip()
        if not v:
            continue
        if not v.isdigit() or int(v) > 60:
            return None, f"{k} must be 0-60 nights"
        c[k] = str(int(v))
    if "trip_min" in c and "trip_max" in c and int(c["trip_max"]) < int(c["trip_min"]):
        return None, "trip length range is invalid"
    return c, None


def active_stages(c):
    s = ["dates"]
    if (c.get("time_from", "00:00"), c.get("time_to", "23:59")) != ("00:00", "23:59"):
        s.append("dep_time")
    if c.get("trip_min") or c.get("trip_max"):
        s.append("nights")
    if c.get("ret_time_from") or c.get("ret_time_to"):
        s.append("ret_time")
    return s


def check(r, c, d_from=None):
    """{stage: passes} for one fare. `d_from` can push the start date later (alerts ignore past days)."""
    dep, ret = r.get("departure_at"), r.get("return_at")
    dt = datetime.datetime.fromisoformat(dep)
    d1 = d_from or datetime.date.fromisoformat(c["date_from"])
    d2 = datetime.date.fromisoformat(c["date_to"])
    mins = dt.hour * 60 + dt.minute
    ok = {"dates": d1 <= dt.date() <= d2,
          "dep_time": hhmm(c.get("time_from", "00:00")) <= mins <= hhmm(c.get("time_to", "23:59"))}
    if ret:
        rdt = datetime.datetime.fromisoformat(ret)
        nights = (rdt.date() - dt.date()).days
        rmins = rdt.hour * 60 + rdt.minute
        n1, n2 = c.get("trip_min"), c.get("trip_max")
        rt1, rt2 = c.get("ret_time_from"), c.get("ret_time_to")
        ok["nights"] = not ((n1 and nights < int(n1)) or (n2 and nights > int(n2)))
        ok["ret_time"] = not ((rt1 and rmins < hhmm(rt1)) or (rt2 and rmins > hhmm(rt2)))
    else:
        ok["nights"] = ok["ret_time"] = False
    return ok


def scan(rows, c, d_from=None):
    """Dedupe + filter. Returns (matched fares cheapest first, near misses [(stage, fare)], funnel, unique total)."""
    stages = active_stages(c)
    seen, matched, near = set(), [], []
    funnel = {k: 0 for k in stages}
    total = 0
    for r in sorted(rows, key=lambda x: x.get("price", 1e12)):
        if not r.get("departure_at"):
            continue
        key = (r["departure_at"], r.get("return_at"), r.get("airline"), r.get("flight_number"))
        if key in seen:
            continue
        seen.add(key)
        total += 1
        ok = check(r, c, d_from)
        failed = [k for k in stages if not ok[k]]
        for k in stages:
            if ok[k]:
                funnel[k] += 1
            else:
                break
        if not failed:
            matched.append(r)
        elif len(failed) == 1:
            near.append((failed[0], r))
    return matched, near, funnel, total


def arrive(dep_iso, minutes, tz_iso):
    """Arrival time in the arrival city's offset, taken from a timestamp that departs from that city
    (outbound arrival -> the return departure's offset; return arrival -> the outbound departure's)."""
    if not dep_iso or not minutes or not tz_iso:
        return None
    t = datetime.datetime.fromisoformat(dep_iso) + datetime.timedelta(minutes=minutes)
    return t.astimezone(datetime.datetime.fromisoformat(tz_iso).tzinfo).isoformat()


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
