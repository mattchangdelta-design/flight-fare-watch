import boto3, json
PLANS = {"tokyo": "TPE-TYO", "seoul": "TPE-SEL"}
T = boto3.resource("dynamodb").Table("subscriptions")
def resp(code, body):
    return {"statusCode": code, "headers": {"content-type": "application/json"}, "body": json.dumps(body, ensure_ascii=False)}
def handler(e, c):
    q = e.get("queryStringParameters") or {}
    email = (q.get("email") or "").strip().lower()
    plan = q.get("plan_name")
    if "@" not in email:
        return resp(400, {"error": "email required"})
    if plan not in PLANS:
        return resp(400, {"error": "plan_name must be tokyo or seoul"})
    T.delete_item(Key={"email": email, "route": PLANS[plan]})
    return resp(200, {"ok": True, "email": email, "route": PLANS[plan], "deleted": True})
