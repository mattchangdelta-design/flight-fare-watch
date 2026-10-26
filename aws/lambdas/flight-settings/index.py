"""flight-settings: GET /settings (any signed-in user) and PUT /settings (admins only).

GET  -> {"billing_enabled": bool, "is_admin": bool}
PUT  body {"billing_enabled": bool} -> the saved settings
Admins are the comma-separated emails in env ADMIN_EMAILS.
Deployed from S3 together with common/auth.py and common/settings.py."""
import base64, json, os
from auth import auth_email, AuthDown
import settings

ADMINS = {a.strip().lower() for a in os.environ.get("ADMIN_EMAILS", "").split(",") if a.strip()}


def resp(code, body):
    return {"statusCode": code, "headers": {"content-type": "application/json", "cache-control": "no-store"},
            "body": json.dumps(body, ensure_ascii=False)}


def handler(e, c):
    try:
        email = auth_email(e)
    except AuthDown:
        return resp(503, {"error": "auth service unavailable"})
    if not email:
        return resp(401, {"error": "sign in required"})
    is_admin = email in ADMINS
    method = ((e.get("requestContext") or {}).get("http") or {}).get("method", "GET")
    if method == "PUT":
        if not is_admin:
            return resp(403, {"error": "admin only"})
        b = e.get("body") or "{}"
        if e.get("isBase64Encoded"):
            b = base64.b64decode(b).decode()
        try:
            d = json.loads(b)
        except Exception:
            return resp(400, {"error": "invalid JSON"})
        if not isinstance(d.get("billing_enabled"), bool):
            return resp(400, {"error": "billing_enabled must be true or false"})
        val = settings.save(d["billing_enabled"], email)
        print("billing_enabled ->", val["billing_enabled"], "by", email)
        return resp(200, {"billing_enabled": val["billing_enabled"], "is_admin": True,
                          "updated_at": val["updated_at"]})
    val = settings.load(fresh=True)
    out = {"billing_enabled": val["billing_enabled"], "is_admin": is_admin}
    if is_admin:
        out.update(updated_at=val["updated_at"], updated_by=val["updated_by"])
    return resp(200, out)
