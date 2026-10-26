"""flight-places (GET /places?q=): destination search for the route picker.

Returns {"origins": [...Taiwan airports], "results": [...up to 10 places]}; an empty q returns
popular destinations with direct flights from Taiwan. Sign-in required.
Deployed from S3 together with common/auth.py and common/places.py."""
import json
from auth import auth_email, AuthDown
import places


def resp(code, body):
    return {"statusCode": code, "headers": {"content-type": "application/json", "cache-control": "private, max-age=300"},
            "body": json.dumps(body, ensure_ascii=False)}


def handler(e, c):
    try:
        if not auth_email(e):
            return resp(401, {"error": "sign in required"})
    except AuthDown:
        return resp(503, {"error": "auth service unavailable"})
    q = ((e.get("queryStringParameters") or {}).get("q") or "")[:40]
    res = [{"code": p["c"], "name": p["n"], "name_en": p["e"], "country": p["cn"], "direct": p["d"]}
           for p in places.search(q)]
    return resp(200, {"origins": [{"code": k, "name": v} for k, v in places.ORIGINS.items()], "results": res})
