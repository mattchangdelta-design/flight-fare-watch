"""Site-wide settings shared by the Lambdas: s3://$CONFIG_BUCKET/settings/site.json.

{"billing_enabled": true|false, "updated_at": "...", "updated_by": "..."}
A missing or unreadable file means billing is ON (the safe default: nobody gets free alerts by accident)."""
import json, os, time
import boto3

BUCKET = os.environ.get("CONFIG_BUCKET", "flight-config-656923393380")
KEY = "settings/site.json"
_s3 = boto3.client("s3")
_cache = {"at": 0.0, "val": None}
TTL = 30  # seconds; a toggle reaches warm containers within this window


def load(fresh=False):
    if not fresh and _cache["val"] is not None and time.time() - _cache["at"] < TTL:
        return _cache["val"]
    try:
        val = json.loads(_s3.get_object(Bucket=BUCKET, Key=KEY)["Body"].read())
    except Exception as ex:
        print("settings unreadable, defaulting to billing on:", type(ex).__name__)
        val = {}
    val = {"billing_enabled": val.get("billing_enabled", True) is not False,
           "updated_at": val.get("updated_at"), "updated_by": val.get("updated_by")}
    _cache.update(at=time.time(), val=val)
    return val


def billing_enabled():
    return load()["billing_enabled"]


def save(billing, who):
    val = {"billing_enabled": bool(billing),
           "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "updated_by": who}
    _s3.put_object(Bucket=BUCKET, Key=KEY, Body=json.dumps(val).encode(), ContentType="application/json")
    _cache.update(at=time.time(), val=val)
    return val
