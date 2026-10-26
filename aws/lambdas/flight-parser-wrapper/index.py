"""flight-parser-wrapper: EventBridge target. Read the routes config from S3
and fan out one async flight-parser invocation per route."""
import os, json
import boto3

_s3 = boto3.client("s3")
_lambda = boto3.client("lambda")


def handler(event, context):
    obj = _s3.get_object(Bucket=os.environ["CONFIG_BUCKET"], Key="flight-routes.json")
    routes = json.loads(obj["Body"].read())
    for r in routes:
        payload = {"origin": r["origin"], "destination": r["destination"],
                   "route": f'{r["origin"]}-{r["destination"]}'}
        _lambda.invoke(FunctionName="flight-parser", InvocationType="Event", Payload=json.dumps(payload))
        print("dispatched", payload["route"])
    return {"ok": True, "dispatched": len(routes)}
