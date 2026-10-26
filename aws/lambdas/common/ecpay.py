"""Shared ECPay helpers for the M2 Lambdas: merchant config, CheckMacValue,
form-body parsing, and the fixed-width UTC timestamps used for current_period_end."""
import base64, calendar, datetime, hashlib, hmac, json, urllib.parse
import boto3

TW = datetime.timezone(datetime.timedelta(hours=8))
FMT = "%Y-%m-%dT%H:%M:%SZ"  # every writer and the parser compare these as strings
_cfg = None


def cfg():
    """flight/ecpay: merchant_id, hash_key, hash_iv, env (stage|prod), amount (TWD)."""
    global _cfg
    if _cfg is None:
        s = boto3.client("secretsmanager").get_secret_value(SecretId="flight/ecpay")["SecretString"]
        _cfg = json.loads(s)
    return _cfg


def host():
    return "payment.ecpay.com.tw" if cfg().get("env") == "prod" else "payment-stage.ecpay.com.tw"


def _enc(s):
    # ECPay's ecpayUrlEncode: quote_plus leaves "~" alone, so encode it, lowercase,
    # then restore the characters .NET leaves unencoded.
    e = urllib.parse.quote_plus(str(s)).replace("~", "%7E").lower()
    for o, n in (("%2d", "-"), ("%5f", "_"), ("%2e", "."), ("%21", "!"),
                 ("%2a", "*"), ("%28", "("), ("%29", ")")):
        e = e.replace(o, n)
    return e


def cmv(params):
    """SHA256 CheckMacValue. Keeps empty-string fields; drops only CheckMacValue itself."""
    c = cfg()
    keys = sorted((k for k in params if k != "CheckMacValue"), key=str.lower)
    raw = "HashKey=%s&%s&HashIV=%s" % (c["hash_key"], "&".join(f"{k}={params[k]}" for k in keys), c["hash_iv"])
    return hashlib.sha256(_enc(raw).encode()).hexdigest().upper()


def cmv_ok(params):
    return hmac.compare_digest(str(params.get("CheckMacValue", "")).upper(), cmv(params))


def form_body(event):
    raw = event.get("body") or ""
    if event.get("isBase64Encoded"):
        raw = base64.b64decode(raw).decode("utf-8")
    return {k: v[0] for k, v in urllib.parse.parse_qs(raw, keep_blank_values=True).items()}


def now_utc():
    return datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0)


def iso(dt):
    return dt.astimezone(datetime.timezone.utc).strftime(FMT)


def parse_iso(s):
    return datetime.datetime.strptime(s, FMT).replace(tzinfo=datetime.timezone.utc)


def local_date(dt):
    return dt.astimezone(TW).strftime("%Y-%m-%d")


def add_period(dt, ptype="M", freq=1):
    """Next paid-through time. Months clamp to the last day (ECPay bills the 31st on the 30th/28th)."""
    freq = int(freq or 1)
    if ptype == "D":
        return dt + datetime.timedelta(days=freq)
    months = freq * (12 if ptype == "Y" else 1)
    y, m = divmod(dt.month - 1 + months, 12)
    y, m = dt.year + y, m + 1
    return dt.replace(year=y, month=m, day=min(dt.day, calendar.monthrange(y, m)[1]))


def text(body, code=200):
    """ECPay only accepts the literal body 1|OK with HTTP 200 as an acknowledgement."""
    return {"statusCode": code, "headers": {"content-type": "text/plain; charset=utf-8"}, "body": body}
