import boto3, json
from decimal import Decimal
from boto3.dynamodb.conditions import Key
T = boto3.resource("dynamodb").Table("subscriptions")
def conv(v):
    if isinstance(v, Decimal):
        return int(v) if v == v.to_integral_value() else float(v)
    return v
def handler(e, c):
    email = ((e.get("queryStringParameters") or {}).get("email") or "").strip().lower()
    if "@" not in email:
        return {"statusCode": 400, "headers": {"content-type": "application/json"}, "body": json.dumps({"error": "email required"})}
    items = T.query(KeyConditionExpression=Key("email").eq(email)).get("Items", [])
    out = [{k: conv(v) for k, v in it.items()} for it in items]
    return {"statusCode": 200, "headers": {"content-type": "application/json"}, "body": json.dumps({"subscriptions": out}, ensure_ascii=False)}
