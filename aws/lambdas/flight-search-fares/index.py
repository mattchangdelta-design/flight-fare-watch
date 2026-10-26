"""flight-search-fares (GET /fares): the site's 查詢目前票價.

Query: route (or legacy plan_name) + the condition fields of common/fares.py.
Returns the 10 cheapest matching round trips, a funnel (fares left after each active filter) and,
when fewer than 5 match, up to 5 near misses (fares failing exactly one condition).
Sign-in required for API Gateway calls; direct IAM invokes (no requestContext) are allowed for ops.
Deployed from S3 together with common/auth.py, common/places.py and common/fares.py."""
import datetime, json
from auth import auth_email, AuthDown
import fares
import places


def resp(code, body):
    return {"statusCode": code, "headers": {"content-type": "application/json"},
            "body": json.dumps(body, ensure_ascii=False)}


def handler(e, c):
    try:
        if "requestContext" in e and not auth_email(e):
            return resp(401, {"error": "sign in required"})
    except AuthDown:
        return resp(503, {"error": "auth service unavailable"})
    q = e.get("queryStringParameters") or {}
    o, d, err = places.parse_route(q)
    if err:
        return resp(400, {"error": err})
    cond, err = fares.parse_conditions(q)
    if err:
        return resp(400, {"error": err})
    route = f"{o}-{d}"
    d1, d2 = datetime.date.fromisoformat(cond["date_from"]), datetime.date.fromisoformat(cond["date_to"])
    rows, errors = [], 0
    for m in fares.months(d1, d2):
        try:
            rows += fares.fetch_month(o, d, m)
        except Exception as ex:
            errors += 1
            print("travelpayouts error", m, type(ex).__name__, getattr(ex, "code", ""))
    matched, near, funnel, total = fares.scan(rows, cond)
    out = [fares.fare(r) for r in matched[:10]]
    near_out = [fares.fare(r, k) for k, r in near[:5]] if len(out) < 5 else []
    print("search", route, json.dumps(cond), "raw", len(rows), "unique", total, "funnel", funnel,
          "matched", len(out), "near", len(near_out))
    return resp(200, {"route": route, "origin_name": places.name(o), "destination_name": places.name(d),
                      "currency": "TWD", "scanned": total, "results": out,
                      "funnel": [{"stage": "total", "count": total}] + [{"stage": k, "count": funnel[k]} for k in funnel],
                      "near": near_out, "months": fares.months(d1, d2), "partial": errors > 0,
                      "conditions": cond})
