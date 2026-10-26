"""flight-fare-notification: SQS consumer. Dedup against notification_history,
render the alert, send it through Resend, then record it (only after a 2xx)."""
import os, json, datetime, urllib.request, urllib.error
from html import escape
import boto3
from boto3.dynamodb.conditions import Key

UA = "Mozilla/5.0 (compatible; flight-notifier/1.0)"
FLOOR_H = float(os.environ.get("NOTIFY_FLOOR_HOURS", "24"))
PCT = float(os.environ.get("REALERT_PCT", "20"))
ABS_TWD = float(os.environ.get("REALERT_ABS_TWD", "2000"))
CITY = {"TPE": "台北", "TYO": "東京", "SEL": "首爾"}
_sm = boto3.client("secretsmanager")
_hist = boto3.resource("dynamodb").Table("notification_history")
_resend = None


class Transient(Exception):
    pass


def resend_cfg():
    global _resend
    if _resend is None:
        _resend = json.loads(_sm.get_secret_value(SecretId="flight/resend")["SecretString"])
    return _resend


# ---------- renderer ----------
def _od(route):
    o, d = route.split("-")
    return o, d


def _ddmm(iso):
    return iso[8:10] + iso[5:7] if iso else ""


AIRLINE = {"CI": "中華航空", "BR": "長榮航空", "JX": "星宇航空", "IT": "台灣虎航", "AE": "華信航空",
           "B7": "立榮航空", "TR": "酷航", "MM": "樂桃航空", "GK": "捷星日本", "3K": "捷星亞洲",
           "JL": "日本航空", "NH": "全日空", "7C": "濟州航空", "LJ": "真航空", "TW": "德威航空",
           "KE": "大韓航空", "OZ": "韓亞航空", "ZE": "易斯達航空", "BX": "釜山航空", "RS": "首爾航空",
           "CX": "國泰航空", "UO": "香港快運", "HX": "香港航空", "D7": "亞洲航空 X", "VJ": "越捷航空",
           "5J": "宿霧太平洋", "MU": "中國東方航空", "CA": "中國國際航空", "CZ": "中國南方航空"}
WEEK = "一二三四五六日"


def _day(iso):
    return f"{int(iso[5:7])}/{int(iso[8:10])}" if iso else "?"


def _when(iso):
    """'2026-11-03T06:50:00+08:00' -> '11/3（二）06:50' (local time of the departure city)."""
    if not iso:
        return "?"
    try:
        dt = datetime.datetime.fromisoformat(iso)
        return f"{dt.month}/{dt.day}（{WEEK[dt.weekday()]}）{dt:%H:%M}"
    except ValueError:
        return _day(iso)


def details(fare):
    """Plain-text detail lines shared by the HTML and text renderers."""
    o, d = _od(fare["route"])
    c = fare["cheapest"]
    code = c.get("airline") or ""
    parts = [f"{AIRLINE[code]}（{code}）" if code in AIRLINE else (code or "-")]
    t = c.get("transfers")
    if t is not None:
        parts.append("直飛" if t == 0 else f"轉機 {t} 次")
    # Travelpayouts only returns the outbound flight number, so it goes on the outbound line.
    fn = c.get("flight_number")
    out_fn = ""
    if fn not in (None, ""):
        s = str(fn)
        out_fn = " · 航班 " + (s if s[:1].isalpha() else f"{code} {s}".strip())
    leg = lambda iso, city: f"{_when(iso)} {CITY.get(city, city)}出發" if iso else "未提供"
    return [f"航空公司：{' · '.join(parts)}",
            f"去程：{leg(c.get('depart_date'), o)}{out_fn if c.get('depart_date') else ''}",
            f"回程：{leg(c.get('return_date'), d)}",
            "時間為出發地當地時間；抵達時間與機場請以訂購頁面為準。"]


def booking_url(fare, marker=None):
    o, d = _od(fare["route"])
    c = fare["cheapest"]
    url = f"https://www.aviasales.com/search/{o}{_ddmm(c.get('depart_date'))}{d}{_ddmm(c.get('return_date'))}1?currency=twd"
    if marker:
        url += f"&marker={marker}"
    return url


def subject(fare):
    o, d = _od(fare["route"])
    return f"✈️ {CITY.get(o, o)} → {CITY.get(d, d)} 降價通知！NT${fare['cheapest']['price']:,} 已達標"


def render_text(fare, target_price, marker=None, usd_price=None):
    o, d = _od(fare["route"])
    c = fare["cheapest"]
    lines = [f"{CITY.get(o, o)} → {CITY.get(d, d)} 來回最低價 NT${c['price']:,}",
             f"你的目標價：NT${target_price:,}"]
    if usd_price is not None:
        lines.append(f"約 US${usd_price:,}")
    lines += [""] + details(fare) + [
              "", f"立即訂購：{booking_url(fare, marker)}", "",
              "票價來自 Travelpayouts 近期搜尋資料，實際價格以訂購頁面為準。"]
    return "\n".join(lines)


def render_html(fare, target_price, marker=None, usd_price=None):
    o, d = _od(fare["route"])
    c = fare["cheapest"]
    usd = f'<p style="margin:4px 0 0;color:#555">約 US${usd_price:,}</p>' if usd_price is not None else ""
    url = escape(booking_url(fare, marker), quote=True)
    det = details(fare)
    rows = "".join(f'<p style="margin:4px 0 0">{escape(x)}</p>' for x in det[:-1])
    note = f'<p style="margin:8px 0 0;font-size:12px;color:#777">{escape(det[-1])}</p>'
    return (
        '<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:480px;color:#111">'
        f'<p style="margin:0 0 8px;font-size:15px">{CITY.get(o, o)} → {CITY.get(d, d)} 來回最低價已低於你的目標價</p>'
        f'<p style="margin:0;font-size:32px;font-weight:700">NT${c["price"]:,}</p>{usd}'
        f'<p style="margin:12px 0 0">你的目標價：NT${target_price:,}</p>'
        f'<div style="margin:12px 0 0">{rows}{note}</div>'
        f'<p style="margin:20px 0"><a href="{url}" style="display:inline-block;background:#2563eb;color:#fff;'
        'padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">立即訂購</a></p>'
        '<p style="margin:0;font-size:12px;color:#777">票價來自 Travelpayouts 近期搜尋資料，實際價格以訂購頁面為準。</p>'
        '</div>')


# ---------- dedup ----------
def last_sent(pk):
    r = _hist.query(KeyConditionExpression=Key("pk").eq(pk), ScanIndexForward=False, Limit=1)
    items = r.get("Items", [])
    return items[0] if items else None


def should_send(last, new_price, now):
    if not last:
        return True, "first alert"
    sent = datetime.datetime.fromisoformat(last["sent_at"])
    if (now - sent).total_seconds() >= FLOOR_H * 3600:
        return True, "floor elapsed"
    prev = float(last["price"])
    if new_price <= prev * (1 - PCT / 100) or (prev - new_price) >= ABS_TWD:
        return True, f"big drop from {prev:.0f}"
    return False, f"within {FLOOR_H:g}h of NT${prev:.0f}"


# ---------- send ----------
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
    email, route = msg["email"], msg["route"]
    price = msg["cheapest"]["price"]
    pk = f"{email}#{route}"
    now = datetime.datetime.now(datetime.timezone.utc)
    ok, why = should_send(last_sent(pk), float(price), now)
    if not ok:
        print("skipped (deduped)", pk, price, why)
        return
    usd = msg.get("cheapest_usd", {}).get("price") if msg.get("cheapest_usd") else None
    tp = int(msg["target_price"])
    cfg = resend_cfg()
    status, resp = send(cfg, email, subject(msg), render_html(msg, tp, usd_price=usd),
                        render_text(msg, tp, usd_price=usd))
    if 200 <= status < 300:
        _hist.put_item(Item={"pk": pk, "sent_at": now.isoformat(timespec="seconds"), "email": email,
                             "route": route, "price": int(price), "currency": "TWD"})
        print("sent", pk, price, why, resp)
    elif status == 429 or status >= 500:
        raise Transient(f"resend {status}: {resp}")
    else:
        print("dropped (permanent)", pk, status, resp)


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
