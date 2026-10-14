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

### 1.1 Parent SKUs and price differences

Two line-level cases never submit silently — both raise a **clarify** and both are
answerable by the buyer in one reply:

- **`line_parent_sku`** — the PO quoted a product-level (parent) SKU on a product that has
  child variants. BC rejects such a cart line outright (422 "This product has options;
  variant ID is required"), so the agent replies listing the child SKUs, their option
  labels, and each one's contract price, and asks which is wanted. Child variants are
  priced individually for that email; the parent line itself carries **no** price and is
  excluded from `submittableLines`, so it can't reach an order or a quote.
- **`price_mismatch`** — the PO's unit price differs from the customer's contract price by
  more than `PO_AGENT_PRICE_TOLERANCE_PCT`. The reply states both numbers and offers two
  routes: **CONFIRM** → place the order at the contract price, or **QUOTE** → submit it as
  a quote for the sales team to review for specialty pricing. The keyword is only honoured
  on a reply to a thread where the agent itself raised the price difference, so a PO that
  merely says "please quote" can't trip it; if a reply says both, QUOTE wins.

Operators get the same two moves as reply templates (`ask_variant`, `offer_price_review`)
on the session-detail card.

### 1.2 Escalations that aren't the buyer's to fix

- **`line_unpriced`** — the store returned no price for a matched product. The PO's own
  price is never used in its place, so the session **escalates** for a person to price it;
  `submitQuote` also refuses such a line, which covers staff force-quote.
- **Store or Redis outages** — a failed BigCommerce read (user, company, credit, payment
  methods, addresses, catalog) escalates as `internal_error` instead of being read as
  "unknown sender" or "no terms", so a real buyer is never rejected during an outage. The
  same goes for a session that can't be loaded from Redis: nothing is saved over it, and
  the message's dedupe claim is released so a later delivery isn't skipped. Metrics, trust
  and token-usage writes are best-effort and never fail a run.
- **Post-placement** — once an order exists it stays recorded on the session, even if
  marking it Awaiting Fulfillment / Pay on Account fails; the decision trail says to check
  it in BigCommerce.

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
  Vercel **previews** don't need it: sign in on production, open Settings → Store →
  Preview access, create a single-use code (10 min), and enter it on the preview's
  `/preview-login` page. The preview session (12 h, Redis-backed `poa_preview` cookie) is
  bound to the same store. Codes are only accepted where `VERCEL_ENV=preview`.
- **Admin views** — `/staff/admin` is the Silk admin view (everything); `/staff/customer`
  is the customer admin view: no Token usage page, no AI model settings, no model names.
  The toggle on the dashboard switches between them and the choice is remembered
  (`poa_view` cookie); `/staff` opens the last one picked. While testing, anyone signed
  in can switch — the hiding is enforced server-side, but it is not access control yet.
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

- **[L1] ✅ DONE** — see §7.1. Read-only: identify → company → pricing → decision.
- **[L2]** one real quote → checkout link; one real terms order → status 11, "Pay on
  Account", B2B poNumber + invoice. **Writes to the store — not yet run.**
- **[L3]** one real extraction per provider on a PDF (BYO proof). Blocked: no provider key.
- **[L6/L7/L9]** Slack/email escalation; Gmail Pub/Sub → threaded reply; Graph
  subscription. Blocked: no Slack webhook / Gmail OAuth / Graph creds configured.

```bash
node scripts/po-agent-live-check.mjs          # quick read-only probe of the store
set -a; . ./.env.local; set +a
PO_AGENT_LIVE=1 npx vitest run tests/live     # the [L1] suite (12 assertions)
```

`node scripts/po-agent-smoke.mjs` runs fixture POs through `/api/po-agent/simulate`
(dry run) against a running app.

### 7.1 [L1] results — sandbox `ybhg7gjokp` ("Catalyst B2B demo")

Verified by `tests/live/l1-sandbox.test.ts`, which exercises the **real** `lib/bc/*` and
`lib/po-agent/core/*` code paths (not a parallel reimplementation) and is skipped unless
`PO_AGENT_LIVE=1`, so `npm test` stays credential-free.

Confirmed working: store token + B2B Edition scope, `getUserByEmail`, `getCompany`,
company payments/credit, SKU resolution, `/v3/pricing/products`, and the full
`identify → resolve → price → validate → decide` path for order / quote / clarify /
reject / unapproved-company.

Store facts that the agent's configuration depends on:

| Fact | Value | Why it matters |
|---|---|---|
| Pay-on-account code | **`cheque`** | This store has **no** `purchase_order` method. `PO_AGENT_PO_PAYMENT_CODES=cheque` is required — the default list would match nothing and every PO would route to a quote as `no_terms`. |
| Contract pricing source | **customer group**, not price list | Group 5 returns 71.52 vs 89.40 base on `LH-2X4-40LM-35K` (−20%). The store has 2 price lists (`Wholesale`, `Cost Plus POC`) but `priceListAssign` is `[]` on **all 16 companies**, so price-list pricing is currently unexercised. |
| B2B credit | enabled on **7 of 16** companies | `assessPayOnAccount` requires `creditEnabled`; a company without it can never reach the order path. |
| `channelList` | `[]` on every user | MSF channel resolution always falls back to `ctx.channelId`. The multi-channel branch is untested live. |
| `inventory_tracking` | `none` across the catalog | `line_inventory_short` can't trigger here — that branch is offline-tested only. |

Canonical fixtures (update these if the sandbox is reseeded):

- **`t.nguyen@pacific-elec.com`** — Pacific Electrical Supply (`12688405`), group 5, credit
  on, approved, role 0 → the happy path, decides **order**.
- **`k.larson@pacific-elec.com`** — same company, role 2 → decides **quote**
  (`buyer_role_requires_approval`).
- **`j.okafor@bridgewater-elec.com`** — Bridgewater (`companyStatus=0`) → not approved.
- **`LH-2X4-40LM-35K`** — visible, priced (89.40 base), untracked inventory.

Two shapes worth knowing (both already handled correctly in `lib/bc/payments.ts`): the
**store**-level `GET /payments` returns `{id, paymentCode, paymentTitle}`, while the
**company**-level `GET /companies/{id}/payments` returns `{code, isEnabled}`. The agent
reads the company-level one.

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
