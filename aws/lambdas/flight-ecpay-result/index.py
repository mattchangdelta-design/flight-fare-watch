"""flight-ecpay-result (ANY /ecpay-result): ECPay returns the shopper with a browser POST
(OrderResultURL). A static SPA answers POST with 405, so this only redirects to the app.
It never activates anything; that is flight-ecpay-return's job."""
import base64, os, urllib.parse

SITE = os.environ.get("SITE_URL", "https://flight-fare-watch.vercel.app").strip().rstrip("/")


def handler(e, c):
    raw = e.get("body") or ""
    if e.get("isBase64Encoded"):
        raw = base64.b64decode(raw).decode("utf-8", "replace")
    p = urllib.parse.parse_qs(raw)
    code = (p.get("RtnCode") or [""])[0]
    state = "success" if code == "1" else ("failed" if code else "unknown")
    print("order result", (p.get("MerchantTradeNo") or [""])[0], code, state)
    return {"statusCode": 302, "headers": {"location": f"{SITE}/app?purchase={state}", "cache-control": "no-store"},
            "body": ""}
