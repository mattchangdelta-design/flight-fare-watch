# AWS backend (M1 price notifier + M2 ECPay subscription)

Source of every Lambda deployed to AWS account `656923393380`, region `us-east-1`.
The site in `src/` only calls the public HTTP API below; it never holds AWS credentials.

```
Site ──POST /subscribe──────▶ flight-save-subscription ──▶ DynamoDB subscriptions
     │                          (unpaid → pending_payment + ECPay checkout form as text/html;
     │                           paying → in-place target update as JSON)
     ──GET /subscriptions───▶ flight-list-subscriptions
     ──DELETE /subscriptions▶ flight-delete-subscription (refuses paid subscriptions: 409)
     ──POST /cancel─────────▶ flight-cancel-subscription ──▶ ECPay CreditCardPeriodAction (Cancel)
     ──GET|PUT /settings─────▶ flight-settings ──▶ s3://flight-config-656923393380/settings/site.json
     ──GET /places───────────▶ flight-places ──▶ s3://flight-config-656923393380/places/places.json
     ──GET /fares────────────▶ flight-search-fares ──▶ Travelpayouts /aviasales/v3/prices_for_dates

ECPay ──POST /ecpay-return──▶ flight-ecpay-return   (1st charge → active)          ─┐
      ──POST /ecpay-period──▶ flight-ecpay-period   (2nd charge on → extend period)  ├▶ SQS flight-status-queue
Browser ─ANY /ecpay-result──▶ flight-ecpay-result   (302 → /app?purchase=…)          │    └▶ flight-status-notification
flight-cancel-subscription ─────────────────────────────────────────────────────────┘        (welcome / cancel email via Resend)

EventBridge flight-price-check (rate 30 min)
  └▶ flight-parser-wrapper ── distinct routes in DynamoDB subscriptions
       └▶ flight-parser (one per route, async) ── each subscriber's conditions; paying rows only while billing is on
            └▶ SQS flight-fare-queue (one message per subscriber whose target is met)
                 └▶ flight-fare-notification ── dedup in DynamoDB notification_history ──▶ Resend email
```

API base URL: `https://z3i3apvemd.execute-api.us-east-1.amazonaws.com` (HTTP API `flight-api`).

## Authentication

`POST /subscribe`, `GET /subscriptions`, `DELETE /subscriptions`, `POST /cancel`, `GET|PUT /settings` and `GET /fares` require
`Authorization: Bearer <Supabase access token>`.
Each function calls Supabase `GET /auth/v1/user` with that token (and the publishable key from
`flight/supabase`) and uses the email Supabase returns; any email sent by the client is ignored.
Missing or invalid token → 401; Supabase unreachable → 503. Results are cached for 5 minutes
per warm container. (API Gateway's built-in JWT authorizer can't be used: it only supports RSA keys
and this Supabase project signs with ES256.)

The ECPay routes (`/ecpay-return`, `/ecpay-period`, `/ecpay-result`) take no token: ECPay calls them.
The two callbacks trust a request only after its CheckMacValue verifies against `flight/ecpay`.

## Routes

Any Taiwan origin (`TPE` 台北, `RMQ` 台中, `KHH` 高雄) to any destination city with an airport. Requests carry
`route` = `ORIGIN-DEST` (e.g. `KHH-OSA`); the old `plan_name` (`tokyo`/`seoul`) is still accepted.
`common/places.py` validates routes against `places/places.json`, which `flight-places-build` builds from
Travelpayouts' public city data (Traditional Chinese names via `st_chars.json` + Taiwan name overrides,
popularity = route count, `d` = direct flight from Taiwan). Re-run `flight-places-build` to refresh it.
Rows store `origin_name`/`destination_name` for emails and the site. One person may track at most
`MAX_ROUTES` (env on `flight-save-subscription`, default 2) routes; with billing on each route is its own
monthly subscription. Less popular routes often have no Travelpayouts data at all.

## Tracking conditions

A subscription row may carry `conditions` (map of strings, same fields as `GET /fares`: `date_from`, `date_to`,
`time_from`, `time_to`, optional `trip_min`/`trip_max` nights and `ret_time_from`/`ret_time_to`). `POST /subscribe`
validates them with `common/fares.py` (range ≤ 92 days, not entirely in the past); omitting `conditions` keeps the
stored ones. `flight-parser` fetches each needed month once per route and, per subscriber, takes the cheapest fare
that passes `fares.check` - the same filter the site's 查詢 uses - ignoring days already past. Rows without
conditions mean next month, any time. Once `date_to` has passed the row gets no alerts (billing is not stopped;
the site asks the user to update the dates or cancel). Alert emails include a 你的條件 line.

## Billing switch (site setting)

`s3://flight-config-656923393380/settings/site.json` = `{"billing_enabled": true|false, "updated_at", "updated_by"}`,
read through `common/settings.py` (30 s cache per container; missing/unreadable file ⇒ billing **on**).
Admins (env `ADMIN_EMAILS` on `flight-settings`) flip it from the dashboard; `PUT /settings` returns 403 for anyone else.

- **On** (default): the M2 paywall below.
- **Off**: `POST /subscribe` saves unpaid rows as `subscription_status = "free"` and returns JSON (no checkout);
  `flight-parser` alerts every subscriber whose target is met. Paying rows are untouched: ECPay keeps charging
  them and they can still cancel. Turning billing back on makes `free` rows unpaid again (完成付款 on the site).

## Subscription lifecycle (M2)

```
pending_payment ──(first charge, /ecpay-return)──▶ active ⇄ target updates in place
      ▲                                              │ POST /cancel (ECPay Cancel; period kept)
      │ re-subscribe + pay                           ▼
   expired ◀──(parser: current_period_end passed)── cancelled (still alerted until period end)
      ▲
      └── 6 consecutive failed renewals (/ecpay-period)
```

- Rows created before M2 have no `subscription_status`; they count as unpaid (not alerted) and the site
  shows them with a 完成付款 button.
- `current_period_end` is a UTC string `YYYY-MM-DDTHH:MM:SSZ` (compared as text by the parser);
  `current_period_end_date` is the Taiwan-local date for display.
- `merchant_trade_no` (≤ 20 chars) identifies the ECPay order; cancel needs it.
- Callbacks always answer the literal `1|OK`; `SimulatePaid=1` (stage backoffice 模擬付款) is acknowledged
  but never activates. Resends are no-ops (first charge keyed on `merchant_trade_no`, renewals on
  `TotalSuccessTimes`).
- Monthly price and merchant: secret `flight/ecpay` (`merchant_id`, `hash_key`, `hash_iv`, `env` = `stage`|`prod`,
  `amount` in TWD). Currently the public stage test merchant `3002607`, NT$300/month. The site shows the fee from
  `MONTHLY_FEE_TWD` in `src/lib/flight-api.ts`; change both together.
- To test renewals without waiting a month, set `PERIOD_TYPE=D` on `flight-save-subscription`
  (checkout becomes daily, 2 charges), subscribe and pay once, check `flight-ecpay-period` logs the next day,
  then set it back to `M`.

## Functions

| Folder | Deployed as | Trigger | Notes |
|---|---|---|---|
| `lambdas/flight-save-subscription` (+ `common/auth.py`, `common/ecpay.py`) | CFN stack `flight-save-subscription`, code from S3 | `POST /subscribe` | Env `API_BASE`, `SITE_URL`, `PERIOD_TYPE` (`M`) |
| `lambdas/flight-list-subscriptions` | CFN stack `flight-list-subscriptions` (inline) | `GET /subscriptions` | Returns the signed-in user's rows (incl. status fields) |
| `lambdas/flight-delete-subscription` | CFN stack `flight-delete-subscription`, code from S3 | `DELETE /subscriptions?route=` | Deletes an unpaid/ended row; 409 for active or cancelled-in-period |
| `lambdas/flight-cancel-subscription` (+ `common/auth.py`, `common/ecpay.py`) | Plain Lambda, code from S3 | `POST /cancel` | Env `STATUS_QUEUE_URL`; ECPay `90100149`/`90100150` are treated as already gone |
| `lambdas/flight-ecpay-return` (+ `common/ecpay.py`) | Plain Lambda, code from S3 | `POST /ecpay-return` | Env `STATUS_QUEUE_URL`; the only writer of `active` |
| `lambdas/flight-ecpay-period` (+ `common/ecpay.py`) | Plain Lambda, code from S3 | `POST /ecpay-period` | Extends `current_period_end`; `expired` after 6 failures |
| `lambdas/flight-ecpay-result` | Plain Lambda, code from S3 | `ANY /ecpay-result` | Env `SITE_URL`; 302 only, never activates |
| `lambdas/flight-status-notification` | Plain Lambda, code from S3 | SQS `flight-status-queue` (batch item failures) | Env `SITE_URL`; `event_type` welcome/cancel; sends once per order |
| `lambdas/flight-settings` (+ `common/auth.py`, `common/settings.py`) | Plain Lambda, code from S3 | `GET /settings`, `PUT /settings` | Env `ADMIN_EMAILS`, `CONFIG_BUCKET` |
| `lambdas/flight-places` (+ `common/auth.py`, `common/places.py`) | Plain Lambda, code from S3 | `GET /places?q=` | Destination search (10 results; empty q = popular direct destinations) |
| `lambdas/flight-places-build` (+ `st_chars.json`) | Plain Lambda, code from S3 | Manual | Rebuilds `places/places.json` (~3.5k cities) |
| `lambdas/flight-search-fares` | Plain Lambda, code from `s3://…/lambda/search.zip` | `GET /fares?route=&date_from=&date_to=&time_from=&time_to=[&trip_min=&trip_max=&ret_time_from=&ret_time_to=]` | Top 10 round-trip fares (TWD) departing in the date range and local-time window; optional nights-away range (local calendar dates) and return departure window; ≤ 92 days; data is Travelpayouts' 48-hour search cache |
| `lambdas/flight-parser-wrapper` | CFN stack `flight-parser-wrapper` (inline) | EventBridge rule `flight-price-check` | Env `CONFIG_BUCKET` |
| `lambdas/flight-parser` | CFN stack `flight-parser`, code from S3 | Invoked by the wrapper | Env `QUEUE_URL`, `CONFIG_BUCKET`; checks **next month**, round trip; serves `active` and `cancelled` rows still inside their period, flips lapsed `cancelled` rows to `expired` |
| `lambdas/flight-fare-notification` | Plain Lambda, code from `s3://…/lambda/notification.zip` | SQS `flight-fare-queue` (batch item failures) | Env `NOTIFY_FLOOR_HOURS=24`, `REALERT_PCT=20`, `REALERT_ABS_TWD=2000` |
| `lambdas/flight-seed` | CFN stack `flight-seed` (inline) | Manual | Deploy helper: writes base64 bytes to S3 |
| `lambdas/flight-pack` | CFN stack `flight-pack` (inline) | Manual | Deploy helper: zips files from a GitHub commit into S3 (see below) |

All functions: Python 3.12, handler `index.handler`, role `flight-lambda-role`
(inline policy `flight-data`: Secrets `flight/*`, DynamoDB on both tables, S3 config bucket,
SQS `flight-fare-queue` + `flight-status-queue`, invoke `flight-parser`).

Secrets Manager: `flight/travelpayouts` (`token`), `flight/resend` (`api_key`, `from`, `test_to`),
`flight/supabase` (`url`, `publishable_key` — used to verify sign-in tokens), `flight/ecpay` (see above),
plus `flight/github` (not read by any Lambda).

`config/flight-routes.json` is the copy of the routes file in the S3 config bucket.

## Redeploying

- **From a commit (all S3-based functions):** push the change, then invoke `flight-pack` with
  `{"repo":"mattchangdelta-design/flight-fare-watch","ref":"<commit sha>","bucket":"flight-config-656923393380",
  "key":"lambda/m2/<sha7>/<name>.zip","files":{"index.py":"aws/lambdas/<fn>/index.py","ecpay.py":"aws/lambdas/common/ecpay.py",…}}`.
  It returns each file's SHA-256 (compare with `sha256sum` locally) and the zip's MD5 (= the S3 ETag).
  Then `aws lambda update-function-code --function-name <fn> --s3-bucket flight-config-656923393380 --s3-key <key>`
  (for the CFN-managed ones you can instead point the stack's `Code.S3Key` at the new key and update the stack).
  Functions that import `auth` / `ecpay` need those files in the same zip.
- **Inline functions (≤ 4,096 chars):** `aws cloudformation update-stack --stack-name <name>` with the
  file contents in `Code.ZipFile`, or zip `index.py` and run `aws lambda update-function-code`.
- **`flight-fare-notification` (too big for inline):** zip `index.py`, upload to
  `s3://flight-config-656923393380/lambda/notification.zip` (check the ETag equals the zip's MD5),
  then `aws lambda update-function-code --function-name flight-fare-notification --s3-bucket … --s3-key lambda/notification.zip`.
- Change the schedule live: `aws events put-rule --name flight-price-check --schedule-expression 'rate(1 hour)'`.

Resend currently sends from `onboarding@resend.dev`, which only delivers to the Resend account
email; any other recipient is logged as `dropped (permanent)` until a sending domain is verified (M3).
