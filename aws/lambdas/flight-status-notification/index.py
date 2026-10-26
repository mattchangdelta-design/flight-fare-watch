"""flight-status-notification: the single SQS consumer for subscription status emails,
routed by event_type ("welcome" after the first payment, "cancel" after cancelling).
Sends once per order and event (recorded on the subscription row after a 2xx).
Resend 429/5xx/network errors are retried by SQS; 403/422 are logged and dropped."""
import json, os, urllib.request, urllib.error
from html import escape
import boto3
from botocore.exceptions import ClientError

UA = "Mozilla/5.0 (compatible; flight-notifier/1.0)"
SITE = os.environ.get("SITE_URL", "https://flight-fare-watch.vercel.app").strip().rstrip("/")
CITY = {"TPE": "台北", "TYO": "東京", "SEL": "首爾"}
T = boto3.resource("dynamodb").Table("subscriptions")
_sm = boto3.client("secretsmanager")
_resend = None


class Transient(Exception):
    pass


def resend_cfg():
    global _resend
    if _resend is None:
        _resend = json.loads(_sm.get_secret_value(SecretId="flight/resend")["SecretString"])
    return _resend


def route_name(route, row=None):
    o, d = route.split("-")
    row = row or {}
    return f"{row.get('origin_name') or CITY.get(o, o)} → {row.get('destination_name') or CITY.get(d, d)}"


def render(msg, row):
    r = route_name(msg["route"], row)
    until = msg.get("current_period_end_date") or row.get("current_period_end_date") or "-"
    tp = row.get("target_price")
    target = f"NT${int(tp):,}" if tp is not None else "-"
    if msg["event_type"] == "welcome":
        subj = f"✈️ 訂閱成功：{r} 機票降價通知已啟用"
        lines = [f"謝謝你的訂閱！{r} 的降價通知已經啟用。",
                 f"目標價：{target}",
                 f"月費：NT${int(msg.get('amount') or 0):,}（綠界信用卡定期定額，每月自動扣款）",
                 f"本期有效至：{until}",
                 "來回最低價一達到目標價，我們就寄信通知你。隨時可以在網站上取消續訂。"]
    else:
        subj = f"已取消續訂：{r} 機票降價通知"
        lines = [f"你已取消 {r} 降價通知的續訂，之後不會再扣款。",
                 f"已付費的期間到 {until} 為止，這段期間仍會照常通知你。",
                 f"目標價：{target}",
                 "想再開啟通知，隨時回到網站重新訂閱即可。"]
    url = SITE + "/app"
    text = "\n".join(lines + ["", f"管理我的追蹤：{url}"])
    html = ('<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:480px;color:#111">'
            + "".join(f'<p style="margin:0 0 8px">{escape(x)}</p>' for x in lines)
            + f'<p style="margin:20px 0"><a href="{escape(url, quote=True)}" style="display:inline-block;'
              'background:#2563eb;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;'
              'font-weight:600">管理我的追蹤</a></p></div>')
    return subj, html, text


def send(cfg, to, subj, html, text):
    body = {"from": cfg["from"], "to": [to], "subject": subj, "html": html, "text": text}
    req = urllib.request.Request("https://api.resend.com/emails", data=json.dumps(body).encode(),
        headers={"Authorization": "Bearer " + cfg["api_key"], "Content-Type": "application/json",
                 "User-Agent": UA}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as ex:
        return ex.code, ex.read().decode()[:300]
    except Exception as ex:
        raise Transient(f"network: {type(ex).__name__}")


def process(msg):
    ev = msg.get("event_type")
    if ev not in ("welcome", "cancel"):
        print("unknown event_type dropped", ev)
        return
    email, route, mtn = msg["email"], msg["route"], msg.get("merchant_trade_no") or "-"
    key = {"email": email, "route": route}
    row = T.get_item(Key=key).get("Item") or {}
    mark = f"{ev}_sent_for"
    if row.get(mark) == mtn:
        print("already sent", ev, email, route, mtn)
        return
    subj, html, text = render(msg, row)
    status, body = send(resend_cfg(), email, subj, html, text)
    if 200 <= status < 300:
        if row:
            try:
                T.update_item(Key=key, UpdateExpression="SET #m=:v", ConditionExpression="attribute_exists(email)",
                              ExpressionAttributeNames={"#m": mark}, ExpressionAttributeValues={":v": mtn})
            except ClientError as ex:
                if ex.response["Error"]["Code"] != "ConditionalCheckFailedException":
                    raise
        print("sent", ev, email, route, mtn, body)
    elif status == 429 or status >= 500:
        raise Transient(f"resend {status}: {body}")
    else:
        print("dropped (permanent)", ev, email, route, status, body)


def handler(event, context):
    failures = []
    for rec in event.get("Records", []):
        try:
            process(json.loads(rec["body"]))
        except Transient as ex:
            print("transient, will retry:", ex)
            failures.append({"itemIdentifier": rec["messageId"]})
        except Exception as ex:
            print("bad message dropped:", type(ex).__name__, ex)
    return {"batchItemFailures": failures}
