"""Route helpers shared by the Lambdas: Taiwan origins, destination lookup, route parsing.

Destinations come from s3://$CONFIG_BUCKET/places/places.json (built by flight-places-build);
each entry is {"c": IATA city code, "n": Traditional Chinese name, "e": English name,
"k": country code, "cn": country name, "w": route count, "d": direct flight from Taiwan}."""
import json, os, re, time
import boto3

BUCKET = os.environ.get("CONFIG_BUCKET", "flight-config-656923393380")
ORIGINS = {"TPE": "台北", "RMQ": "台中", "KHH": "高雄"}
LEGACY = {"tokyo": "TPE-TYO", "seoul": "TPE-SEL"}  # plan names used before free route choice
_RE = re.compile(r"^[A-Z]{3}-[A-Z]{3}$")
_s3 = boto3.client("s3")
_cache = {"at": 0.0, "list": None, "by": None}
TTL = 3600


def places():
    if _cache["list"] is None or time.time() - _cache["at"] > TTL:
        try:
            lst = json.loads(_s3.get_object(Bucket=BUCKET, Key="places/places.json")["Body"].read())
        except Exception as ex:
            print("places unavailable:", type(ex).__name__)
            lst = _cache["list"] or []
        _cache.update(at=time.time(), list=lst, by={p["c"]: p for p in lst})
    return _cache["list"]


def get(code):
    places()
    return _cache["by"].get(code)


def name(code):
    if code in ORIGINS:
        return ORIGINS[code]
    p = get(code)
    return p["n"] if p else code


def parse_route(d):
    """(origin, destination, None) or (None, None, error message) from {"route"} or legacy {"plan_name"}."""
    route = str(d.get("route") or LEGACY.get(d.get("plan_name")) or "").strip().upper()
    if not _RE.match(route):
        return None, None, "route must look like TPE-OSA"
    o, dst = route.split("-")
    if o not in ORIGINS:
        return None, None, "origin must be TPE, RMQ or KHH"
    if dst == o:
        return None, None, "destination must differ from origin"
    if places() and not get(dst):
        return None, None, "unknown destination"
    return o, dst, None


def search(q, limit=10):
    q = (q or "").strip()
    if not q:
        return [p for p in places() if p["d"]][:limit]
    ql = q.lower()
    hits = []
    for p in places():
        n, en, c, cn = p["n"], p["e"].lower(), p["c"].lower(), p["cn"]
        if c == ql:
            r = 0
        elif n.startswith(q):
            r = 1
        elif en.startswith(ql):
            r = 2
        elif q in n:
            r = 3
        elif ql in en:
            r = 4
        elif q in cn:
            r = 5
        else:
            continue
        hits.append((r, not p["d"], -p["w"], p))
    hits.sort(key=lambda h: h[:3])
    return [h[3] for h in hits[:limit]]
