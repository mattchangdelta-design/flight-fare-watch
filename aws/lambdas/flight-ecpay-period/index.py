"""flight-ecpay-period (POST /ecpay-period): ECPay's result for every scheduled charge from
the SECOND period on. A success extends current_period_end by one period; a failure only
counts (ECPay retries and terminates the contract itself after 6 consecutive failures).
Idempotent on TotalSuccessTimes (or ProcessDate). Always answers 1|OK."""
import json
import boto3
from botocore.exceptions import ClientError
import ecpay

T = boto3.resource("dynamodb").Table("subscriptions")
LOG = ("MerchantTradeNo", "RtnCode", "RtnMsg", "Amount", "ProcessDate", "PeriodType", "Frequency", "ExecTimes",
       "TotalSuccessTimes", "gwsr", "Gwsr", "SimulatePaid", "CustomField2")
MAX_FAILS = 6


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
        print("simulated renewal: acknowledged, not recorded", mtn)
        return ecpay.text("1|OK")

    email, route = p.get("CustomField1", "").strip().lower(), p.get("CustomField2", "")
    key = {"email": email, "route": route}
    it = T.get_item(Key=key).get("Item")
    if not it:
        print("WARNING renewal for a missing subscription row", email, route, mtn)
        return ecpay.text("1|OK")
    if it.get("merchant_trade_no") != mtn:
        print("WARNING renewal for an order that is not the row's current one", it.get("merchant_trade_no"), mtn)
        return ecpay.text("1|OK")
    now = ecpay.now_utc()

    if p.get("RtnCode") == "1":
        total = int(p.get("TotalSuccessTimes") or 0)
        pdate = p.get("ProcessDate", "")
        base = ecpay.parse_iso(it["current_period_end"]) if it.get("current_period_end") else now
        end = ecpay.add_period(base, p.get("PeriodType") or it.get("period_type") or "M",
                               p.get("Frequency") or it.get("period_frequency") or 1)
        # Paid again: a lapsed/unpaid row becomes active; a cancelled row keeps its status.
        status = it.get("subscription_status")
        status = "active" if status in ("expired", "pending_payment") else status
        if total:
            cond, vals = "attribute_not_exists(total_success_times) OR total_success_times < :ts", {":ts": total}
        else:
            cond, vals = "attribute_not_exists(last_process_date) OR last_process_date <> :pd", {}
        try:
            T.update_item(Key=key, ConditionExpression=cond,
                UpdateExpression="SET current_period_end=:e, current_period_end_date=:ed, last_charged_at=:n, "
                                 "last_process_date=:pd, failed_attempts=:z, subscription_status=:s"
                                 + (", total_success_times=:ts" if total else ""),
                ExpressionAttributeValues={**vals, ":e": ecpay.iso(end), ":ed": ecpay.local_date(end),
                                           ":n": ecpay.iso(now), ":pd": pdate, ":z": 0, ":s": status})
            print("renewed", email, route, mtn, "charge", total or pdate, "paid through", ecpay.iso(end))
        except ClientError as ex:
            if ex.response["Error"]["Code"] != "ConditionalCheckFailedException":
                raise
            print("renewal already recorded (resend)", mtn, total or pdate)
        return ecpay.text("1|OK")

    fails = int(it.get("failed_attempts", 0)) + 1
    status = "expired" if fails >= MAX_FAILS else it.get("subscription_status")
    T.update_item(Key=key,
        UpdateExpression="SET failed_attempts=:f, last_failed_at=:n, last_fail_msg=:m, subscription_status=:s",
        ExpressionAttributeValues={":f": fails, ":n": ecpay.iso(now), ":m": p.get("RtnMsg", ""), ":s": status})
    print("renewal failed", email, route, mtn, "attempt", fails, p.get("RtnCode"), p.get("RtnMsg"),
          "-> expired" if status == "expired" else "")
    return ecpay.text("1|OK")
