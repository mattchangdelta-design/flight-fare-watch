# AWS backend (M1 — free price notifier)

Source of every Lambda deployed to AWS account `656923393380`, region `us-east-1`.
The site in `src/` only calls the public HTTP API below; it never holds AWS credentials.

```
Site ──POST /subscribe──────▶ flight-save-subscription ──▶ DynamoDB subscriptions
     ──GET /subscriptions───▶ flight-list-subscriptions ─┘
     ──DELETE /subscriptions▶ flight-delete-subscription ┘
     ──GET /fares────────────▶ flight-search-fares ──▶ Travelpayouts /aviasales/v3/prices_for_dates

EventBridge flight-price-check (rate 30 min)
  └▶ flight-parser-wrapper ── reads s3://flight-config-656923393380/flight-routes.json
       └▶ flight-parser (one per route, async) ── Travelpayouts /v1/prices/cheap (TWD + USD)
            └▶ SQS flight-fare-queue (one message per subscriber whose target is met)
                 └▶ flight-fare-notification ── dedup in DynamoDB notification_history ──▶ Resend email
```

API base URL: `https://z3i3apvemd.execute-api.us-east-1.amazonaws.com` (HTTP API `flight-api`).

## Authentication

All four API endpoints require `Authorization: Bearer <Supabase access token>`.
Each function calls Supabase `GET /auth/v1/user` with that token (and the publishable key from
`flight/supabase`) and uses the email Supabase returns; any email sent by the client is ignored.
Missing or invalid token → 401; Supabase unreachable → 503. Results are cached for 5 minutes
per warm container. (API Gateway's built-in JWT authorizer can't be used: it only supports RSA keys
and this Supabase project signs with ES256.)

## Functions

| Folder | Deployed as | Trigger | Notes |
|---|---|---|---|
| `lambdas/flight-save-subscription` | CFN stack `flight-save-subscription` (inline) | `POST /subscribe` | Upserts `{route, target_price}` for the signed-in user; keeps `created_at` |
| `lambdas/flight-list-subscriptions` | CFN stack `flight-list-subscriptions` (inline) | `GET /subscriptions` | Returns the signed-in user's rows |
| `lambdas/flight-delete-subscription` | CFN stack `flight-delete-subscription` (inline) | `DELETE /subscriptions?plan_name=` | Deletes one of the signed-in user's rows |
| `lambdas/flight-search-fares` | Plain Lambda, code from `s3://…/lambda/search.zip` | `GET /fares?plan_name=&date_from=&date_to=&time_from=&time_to=` | Top 10 round-trip fares (TWD) departing in the date range and local-time window; ≤ 92 days; data is Travelpayouts' 48-hour search cache |
| `lambdas/flight-parser-wrapper` | CFN stack `flight-parser-wrapper` (inline) | EventBridge rule `flight-price-check` | Env `CONFIG_BUCKET` |
| `lambdas/flight-parser` | CFN stack `flight-parser` (inline) | Invoked by the wrapper | Env `QUEUE_URL`, `CONFIG_BUCKET`; checks **next month**, round trip |
| `lambdas/flight-fare-notification` | Plain Lambda, code from `s3://…/lambda/notification.zip` | SQS `flight-fare-queue` (batch item failures) | Env `NOTIFY_FLOOR_HOURS=24`, `REALERT_PCT=20`, `REALERT_ABS_TWD=2000` |
| `lambdas/flight-seed` | CFN stack `flight-seed` (inline) | Manual | Deploy helper: writes base64 bytes to S3 |

All functions: Python 3.12, handler `index.handler`, role `flight-lambda-role`
(inline policy `flight-data`: Secrets `flight/*`, DynamoDB on both tables, S3 config bucket,
SQS fare queue, invoke `flight-parser`).

Secrets Manager: `flight/travelpayouts` (`token`), `flight/resend` (`api_key`, `from`, `test_to`),
`flight/supabase` (`url`, `publishable_key` — used to verify sign-in tokens), plus `flight/github` (not read by any Lambda).

`config/flight-routes.json` is the copy of the routes file in the S3 config bucket.

## Redeploying

- **Inline functions (≤ 4,096 chars):** `aws cloudformation update-stack --stack-name <name>` with the
  file contents in `Code.ZipFile`, or zip `index.py` and run `aws lambda update-function-code`.
- **`flight-fare-notification` (too big for inline):** zip `index.py`, upload to
  `s3://flight-config-656923393380/lambda/notification.zip` (check the ETag equals the zip's MD5),
  then `aws lambda update-function-code --function-name flight-fare-notification --s3-bucket … --s3-key lambda/notification.zip`.
- Change the schedule live: `aws events put-rule --name flight-price-check --schedule-expression 'rate(1 hour)'`.

Resend currently sends from `onboarding@resend.dev`, which only delivers to the Resend account
email; any other recipient is logged as `dropped (permanent)` until a sending domain is verified (M3).
