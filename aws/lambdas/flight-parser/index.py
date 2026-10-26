"""flight-parser: one route per invocation.

For every subscriber of the route who should get alerts (paying, or anyone while billing is off),
find the cheapest fare that matches *their* conditions (stored on the row; rows without conditions
mean next month, any time) and enqueue an alert when it is at or below their target price.
Fares come from Travelpayouts prices_for_dates, fetched once per month the subscribers need.
Days already past are ignored; a subscription whose whole date range has passed gets no alerts.
Uses common/fares.py - the same filter as the site's 查詢 - so both agree on what matches.
Deployed from S3 together with common/settings.py, common/places.py and common/fares.py."""
import os, json, datetime, hashlib, time
from decimal import Decimal
import boto3
from boto3.dynamodb.conditions import Attr, Key
import settings  # common/settings.py, zipped alongside
import places  # common/places.py, zipped alongside
import fares  # common/fares.py, zipped alongside

_sqs = boto3.client("sqs")
_table = boto3.resource("dynamodb").Table("subscriptions")
_hist = boto3.resource("dynamodb").Table("price_history")
HEARTBEAT_H = 6        # write an unchanged point at least this often so the chart shows the price held
KEEP_DAYS = 180        # price_history TTL
QURL = os.environ["QUEUE_URL"]


def subscribers(route):
    kw = {"FilterExpression": Attr("route").eq(route)}
    while True:
        r = _table.scan(**kw)
        yield from r.get("Items", [])
        if "LastEvaluatedKey" not in r:
            return
        kw["ExclusiveStartKey"] = r["LastEvaluatedKey"]


def gate(it, now):
    """M2 paywall: serve active rows and cancelled rows still inside the paid period;
    retire cancelled rows whose period has ended. pending_payment/expired/legacy are skipped."""
    st = it.get("subscription_status")
    if st == "active":
        return True
    if st == "cancelled":
        if it.get("current_period_end", "") >= now:
            return True
        try:
            _table.update_item(Key={"email": it["email"], "route": it["route"]},
                UpdateExpression="SET subscription_status=:x, expired_at=:n",
                ConditionExpression="subscription_status=:c AND current_period_end < :n",
                ExpressionAttributeValues={":x": "expired", ":c": "cancelled", ":n": now})
            print("expired (grace over)", it["email"], it["route"])
        except _table.meta.client.exceptions.ConditionalCheckFailedException:
            pass
    return False


def conditions_of(it, today):
    """(conditions, effective start date) or (None, None) when the range is over."""
    c = it.get("conditions")
    cond = {k: str(v) for k, v in c.items()} if isinstance(c, dict) and c.get("date_from") else fares.legacy_conditions(today)
    d1 = datetime.date.fromisoformat(cond["date_from"])
    d2 = datetime.date.fromisoformat(cond["date_to"])
    if d2 < today:
        return None, None
    return cond, max(d1, today)


def message_fare(r):
    """The `cheapest` block flight-fare-notification renders."""
    return {"price": r.get("price"), "currency": "TWD", "airline": r.get("airline"),
            "flight_number": r.get("flight_number"), "transfers": r.get("transfers"),
            "return_transfers": r.get("return_transfers"),
            "depart_date": r.get("departure_at"), "return_date": r.get("return_at"),
            "origin_airport": r.get("origin_airport"), "destination_airport": r.get("destination_airport")}


def cond_hash(cond):
    return hashlib.sha1(json.dumps(cond, sort_keys=True).encode()).hexdigest()[:8]


def itin_key(r):
    return "|".join(str(r.get(k) or "") for k in ("departure_at", "return_at", "airline", "flight_number"))


def record(it, route, cond, hits, now_iso):
    """Price trend point for this subscription: cheapest matching price (or none), how many fares matched,
    which itinerary it was, and which conditions. Written when something changed or every HEARTBEAT_H hours."""
    sub = f"{it['email']}#{route}"
    best = hits[0] if hits else None
    point = {"price": int(best["price"]) if best else None, "count": len(hits),
             "key": itin_key(best) if best else "", "cond": cond_hash(cond)}
    try:
        last = _hist.query(KeyConditionExpression=Key("sub").eq(sub), ScanIndexForward=False, Limit=1).get("Items", [])
        if last:
            l = last[0]
            same = (l.get("price") == point["price"] and int(l.get("count", 0)) == point["count"]
                    and l.get("key", "") == point["key"] and l.get("cond") == point["cond"])
            age_h = (datetime.datetime.fromisoformat(now_iso.replace("Z", "+00:00"))
                     - datetime.datetime.fromisoformat(l["t"].replace("Z", "+00:00"))).total_seconds() / 3600
            if same and age_h < HEARTBEAT_H:
                return
        item = {"sub": sub, "t": now_iso, "count": point["count"], "key": point["key"], "cond": point["cond"],
                "expires": int(time.time()) + KEEP_DAYS * 86400}
        if best:
            item.update(price=point["price"], depart=best.get("departure_at"), ret=best.get("return_at") or "",
                        airline=best.get("airline") or "")
        _hist.put_item(Item=item)
    except Exception as ex:  # history must never block alerts
        print("history write failed", sub, type(ex).__name__, ex)


def handler(event, context):
    origin, destination = event["origin"], event["destination"]
    route = event.get("route") or f"{origin}-{destination}"
    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    today = fares.today_tw()
    billing = settings.billing_enabled()
    # gate() always runs so lapsed cancelled rows still flip to expired; with billing off everyone is served.
    subs = [it for it in subscribers(route) if gate(it, now) or not billing]
    if not subs:
        print(route, "no paying subscribers - skipping" if billing else "no subscribers - skipping")
        return {"ok": True, "route": route, "matched": 0}

    plans, need = [], set()
    for it in subs:
        cond, d_from = conditions_of(it, today)
        if cond is None:
            print("date range over - no alert", it["email"], route, it.get("conditions", {}).get("date_to"))
            continue
        plans.append((it, cond, d_from))
        need.update(fares.months(d_from, datetime.date.fromisoformat(cond["date_to"])))
    if not plans:
        return {"ok": True, "route": route, "matched": 0}

    rows, errors = [], 0
    for m in sorted(need):
        try:
            rows += fares.fetch_month(origin, destination, m)
        except Exception as ex:
            errors += 1
            print("travelpayouts error", m, type(ex).__name__, getattr(ex, "code", ""))
    print(route, "months", sorted(need), "fares", len(rows), "subscribers", len(plans), "billing", billing)

    matched = 0
    for it, cond, d_from in plans:
        hits, _, _, _ = fares.scan(rows, cond, d_from)
        if not errors:  # a failed month fetch would look like a price change
            record(it, route, cond, hits, now)
        if not hits:
            print("no matching fare", it["email"], route, json.dumps(cond))
            continue
        best = hits[0]
        tp = Decimal(str(it["target_price"]))
        print("best", it["email"], route, best.get("price"), "target", int(tp))
        if tp < Decimal(str(best["price"])):
            continue
        body = {"email": it["email"], "route": route, "plan_name": it.get("plan_name"),
                "origin_name": it.get("origin_name") or places.name(origin),
                "destination_name": it.get("destination_name") or places.name(destination),
                "target_price": int(tp), "cheapest": message_fare(best),
                "conditions": cond if isinstance(it.get("conditions"), dict) else None}
        _sqs.send_message(QueueUrl=QURL, MessageBody=json.dumps(body))
        matched += 1
    print(route, "matched", matched, "errors", errors)
    return {"ok": True, "route": route, "matched": matched}
