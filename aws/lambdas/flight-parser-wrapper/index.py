"""flight-parser-wrapper: EventBridge target. Fan out one async flight-parser invocation
per distinct route that anyone subscribes to (routes are free-form since route choice opened up)."""
import json
import boto3

_table = boto3.resource("dynamodb").Table("subscriptions")
_lambda = boto3.client("lambda")


def routes():
    seen, kw = set(), {"ProjectionExpression": "#r", "ExpressionAttributeNames": {"#r": "route"}}
    while True:
        r = _table.scan(**kw)
        seen.update(i["route"] for i in r.get("Items", []) if i.get("route"))
        if "LastEvaluatedKey" not in r:
            return sorted(seen)
        kw["ExclusiveStartKey"] = r["LastEvaluatedKey"]


def handler(event, context):
    rs = routes()
    for route in rs:
        o, d = route.split("-")
        _lambda.invoke(FunctionName="flight-parser", InvocationType="Event",
                       Payload=json.dumps({"origin": o, "destination": d, "route": route}))
        print("dispatched", route)
    return {"ok": True, "dispatched": len(rs)}
