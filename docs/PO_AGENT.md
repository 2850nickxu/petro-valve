# PO Agent — Operator Runbook

Email-first purchase-order processing for BigCommerce B2B Edition. Buyers email a PO
(PDF / spreadsheet / text); the agent identifies the buyer, parses the PO, enforces the
same B2B controls the storefront would, and submits an **order** (pay-on-account) or a
**quote** (with a checkout link) — replying on the same thread.

## 1. Architecture at a glance

```
inbound email → dedupe → identify → AI extract → resolve SKUs + customer pricing →
  validate (B2B controls) → decide (order vs quote) → submit → reply
                   ↘ clarify (≤2 rounds) ↘ escalate (rep email + Slack + review queue)
```

- `lib/bc/*` — session-less BigCommerce/B2B client layer (`StoreContext`, Management API).
- `lib/po-agent/*` — pipeline: config, state, channels, AI, business core, escalation.
- `app/api/po-agent/*` — inbound webhooks, worker, cron.
- `app/staff/po-inbox` — review queue + metrics. `app/demo` — zero-cred simulator.

Everything is inert until `PO_AGENT_ENABLED=true`.

## 2. Try it with no credentials (the demo)

```bash
npm install
npm run dev            # http://localhost:3000/demo
```

Paste a PO in `/demo` and run the pipeline (dry run — no email, no submit). With no
BigCommerce creds it shows heuristic extraction; add store creds (below) for the full
identify → pricing → decision. `npm test` runs the offline unit suite (no creds needed).

## 3. Environment

Copy `.env.example` → `.env.local`. Key groups:

- **BigCommerce** (`BIGCOMMERCE_STORE_HASH`, `BIGCOMMERCE_ACCESS_TOKEN` with B2B scope =
  modify, `BIGCOMMERCE_CHANNEL_ID`). The B2B token IS the store token — no separate token.
- **AI (BYO)** — `PO_AGENT_MODEL="provider:model-id"` (e.g. `anthropic:claude-sonnet-4-6`)
  + that provider's key (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / …). Omit to use the
  built-in heuristic extractor.
- **Redis** — `UPSTASH_REDIS_REST_URL` / `_TOKEN` (required for real processing).
- **Channel** — `PO_AGENT_CHANNEL=google|microsoft` + the channel creds (below).
- **Escalation** — `PO_AGENT_ESCALATION_EMAIL`, `PO_AGENT_SLACK_WEBHOOK_URL`.
- **Staff gate** — `PO_AGENT_STAFF_SECRET` (required in production for `/staff`).
- **Tuning** — clarification cap, price tolerance, first-order confirm, daily cap, etc.

Resolve the store's pay-on-account payment code: `GET /api/v3/io/payments` on the sandbox
→ set `PO_AGENT_PO_PAYMENT_CODES` (e.g. `purchase_order`).

## 4. Gmail channel setup (POC)

1. **GCP project** → enable Gmail API + Pub/Sub.
2. **Pub/Sub topic** (`GOOGLE_PO_PUBSUB_TOPIC`) and grant publish to
   `gmail-api-push@system.gserviceaccount.com`.
3. **Push subscription** → endpoint `https://<app>/api/po-agent/inbound/google?token=<PO_AGENT_INBOUND_SECRET>`.
4. **OAuth client** (Web application, mark the consent screen "Internal") with redirect
   `http://localhost:53682/oauth2callback`. Set `GOOGLE_PO_CLIENT_ID/SECRET`.
5. **Refresh token** — sign in as the mailbox user:
   ```bash
   GOOGLE_PO_CLIENT_ID=… GOOGLE_PO_CLIENT_SECRET=… node scripts/po-agent-google-consent.mjs
   ```
   Paste the printed `GOOGLE_PO_REFRESH_TOKEN` into `.env.local`. Set `PO_AGENT_MAILBOX`.
6. **Register the watch** — hit `/api/po-agent/cron/renew-watch` (Bearer = inbound secret).
   The daily Vercel cron (`vercel.json`) keeps it renewed; `/cron/poll` is a fallback and
   runs the nudge/expiry lifecycle sweep.

If Pub/Sub is blocked by org policy, run in **polling mode only** — the `/cron/poll`
schedule covers it.

## 5. Microsoft (Graph) channel setup

Set `PO_AGENT_CHANNEL=microsoft` and `MS_PO_TENANT_ID/CLIENT_ID/CLIENT_SECRET/MAILBOX`.
App (client-credentials) permissions `Mail.Read` + `Mail.Send`, scoped to the mailbox via
an Exchange application access policy. Create a Graph subscription whose `notificationUrl`
is `/api/po-agent/inbound/microsoft` and `clientState = PO_AGENT_INBOUND_SECRET`; the route
echoes the validation token on creation.

## 6. Deployment (Vercel)

- Set env vars; `vercel.json` registers the renew-watch (daily) and poll (5-min) crons.
- Set `CRON_SECRET = PO_AGENT_INBOUND_SECRET` so cron calls authenticate.
- Node runtime routes; `maxDuration` set on the heavy worker/poll routes.

## 7. Live verification (sandbox) — the [L] steps

- **[L1]** one `getUserByEmail` / `getCompany` / pricing round-trip; confirm a known
  company returns contract (not base) pricing; pin the payment code + `channelList` shape.
- **[L2]** one real quote → checkout link; one real terms order → status 11, "Pay on
  Account", B2B poNumber + invoice.
- **[L3]** one real extraction per provider on a PDF (BYO proof).
- **[L6/L7/L9]** Slack/email escalation; Gmail Pub/Sub → threaded reply; Graph subscription.

`node scripts/po-agent-smoke.mjs` runs fixture POs through `/api/po-agent/simulate`
(dry run) against a running app.

## 8. Demo script (sales)

1. Open `/demo`. Paste the clean terms PO → decision **order** with priced lines + audit.
2. Change "pay on account" → "pay by credit card" → decision **quote** (checkout link).
3. Change the sender to an unknown address → **reject**.
4. Break a SKU → **clarify** with the exact question.
5. Open `/staff/po-inbox` → metrics strip + escalated/recent queues + a session detail
   with the full audit trail and force-order/quote/dismiss actions.

## 9. Phase B — standalone BigCommerce app (design-complete)

Phase A isolates every store-scoped dependency behind `lib/bc/store-context.ts`. To ship
as a per-store single-click app later:

1. **Dev portal** (devtools.bigcommerce.com): create app → scopes (Products/Customers
   read, Orders/Carts/Checkouts modify, Price lists read, **B2B Edition modify**) →
   callbacks `/api/bc-app/{auth,load,uninstall,remove_user}`.
2. **OAuth** `/auth`: exchange `code` at `login.bigcommerce.com/oauth2/token` →
   persist `{storeHash → accessToken}` → resolve `StoreContext` per store.
3. **`/load` / `/uninstall`**: verify `signed_payload_jwt` (HS256, `iss="bc"`,
   `aud=CLIENT_ID`) → control-panel iframe UI (BigDesign).
4. **App Extensions** (GraphQL Admin, `store_app_extensions_manage`): PANEL on Orders +
   Customers pages.
5. **Multi-store email**: move per-store mailbox config into the app DB keyed by store
   hash — the `EmailChannel` interface already takes creds via constructor.

This is a back-office app (Management APIs only, channel-aware) ⇒ Catalyst-compatible by
construction.
