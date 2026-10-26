"""flight-ecpay-return (POST /ecpay-return): ECPay's server-to-server result for the FIRST
period of a 信用卡定期定額 order. The only place a subscription becomes active.

Verifies CheckMacValue + MerchantID, ignores SimulatePaid, activates the row named by
CustomField1/2 (email, route), sets current_period_end, queues the welcome email, and
always answers the literal 1|OK so ECPay stops retrying. Idempotent on MerchantTradeNo."""
import json, os
import boto3
import ecpay

T = boto3.resource("dynamodb").Table("subscriptions")
SQS = boto3.client("sqs")
QURL = os.environ["STATUS_QUEUE_URL"]
LOG = ("MerchantTradeNo", "RtnCode", "RtnMsg", "TradeNo", "TradeAmt", "Amount", "PaymentDate", "PaymentType",
       "PeriodType", "Frequency", "ExecTimes", "TotalSuccessTimes", "Gwsr", "gwsr", "SimulatePaid", "CustomField2")


def handler(e, c):
    p = ecpay.form_body(e)
    mtn = p.get("MerchantTradeNo", "")
    print("callback", json.dumps({k: p[k] for k in LOG if k in p}, ensure_ascii=False), "keys=" + ",".join(sorted(p)))
    if not ecpay.cmv_ok(p):
        print("CheckMacValueInvalid", mtn)
        return ecpay.text("0|CheckMacValueInvalid", 400)
    if p.get("MerchantID") != ecpay.cfg()["merchant_id"]:
        print("MerchantID mismatch", p.get("MerchantID"))
        return ecpay.text("0|MerchantIDMismatch", 400)
    if p.get("SimulatePaid") == "1":
        print("simulated payment: acknowledged, not activated", mtn)
        return ecpay.text("1|OK")
    if p.get("RtnCode") != "1":
        # A failed first authorization never enters ECPay's schedule; the row stays pending_payment.
        print("first authorization failed", mtn, p.get("RtnCode"), p.get("RtnMsg"))
        return ecpay.text("1|OK")

    email, route = p.get("CustomField1", "").strip().lower(), p.get("CustomField2", "")
    key = {"email": email, "route": route}
    it = T.get_item(Key=key).get("Item")
    if not it:
        print("WARNING paid order has no subscription row", email, route, mtn)
        return ecpay.text("1|OK")
    if it.get("subscription_status") == "active" and it.get("merchant_trade_no") == mtn:
        print("already active for this order (resend)", mtn)
        return ecpay.text("1|OK")
    if it.get("merchant_trade_no") not in (None, mtn):
        print("WARNING paid order differs from the row's latest checkout", it.get("merchant_trade_no"), "->", mtn)

    ptype = p.get("PeriodType") or it.get("period_type") or "M"
    freq = p.get("Frequency") or "1"
    now = ecpay.now_utc()
    end = ecpay.add_period(now, ptype, freq)
    T.update_item(Key=key,
        UpdateExpression="SET subscription_status=:a, merchant_trade_no=:m, period_type=:pt, period_frequency=:f, "
                         "current_period_end=:e, current_period_end_date=:ed, activated_at=:n, last_charged_at=:n, "
                         "total_success_times=:ts, failed_attempts=:z, ecpay_trade_no=:tn REMOVE cancelled_at",
        ExpressionAttributeValues={":a": "active", ":m": mtn, ":pt": ptype, ":f": int(freq),
                                   ":e": ecpay.iso(end), ":ed": ecpay.local_date(end), ":n": ecpay.iso(now),
                                   ":ts": int(p.get("TotalSuccessTimes") or 1), ":z": 0,
                                   ":tn": p.get("TradeNo") or ""})
    SQS.send_message(QueueUrl=QURL, MessageBody=json.dumps({
        "event_type": "welcome", "email": email, "route": route, "merchant_trade_no": mtn,
        "amount": int(p.get("TradeAmt") or p.get("Amount") or ecpay.cfg()["amount"]),
        "current_period_end_date": ecpay.local_date(end)}, ensure_ascii=False))
    print("activated", email, route, mtn, "paid through", ecpay.iso(end))
    return ecpay.text("1|OK")
