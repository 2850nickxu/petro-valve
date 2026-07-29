# Offline PO Agent

An email-first AI agent that turns B2B buyers' emailed purchase orders (PDF, spreadsheet,
or plain text) into **BigCommerce B2B Edition** orders or quotes — enforcing the same
controls the storefront would (buyer identity, customer-specific pricing, catalog
assortment, credit, quote gating).

Standalone Next.js (App Router) app, session-less and server-to-server. Designed so the
whole decision architecture is **buildable and unit-testable offline**, with live
BigCommerce / Gmail / AI-provider credentials needed only at clearly-labeled steps.

## Deployment

- **Live:** https://offline-po-app.vercel.app (admin at `/staff`, public demo at `/demo`)
- Hosted on Vercel (project `offline-po-app`), connected to this repo — **pushes to `main`
  auto-deploy to production**; pull requests get preview URLs.
- Configuration is self-service in the app (**Settings**); secrets are encrypted at rest.
- **DevOps:** feature-branch commits auto-ship to production through a CI-gated PR pipeline —
  runbook in [`docs/DEVOPS.md`](docs/DEVOPS.md). Environment & secrets layout:
  [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md).

## Status

Under active construction — phased build (see the plan). The first runnable milestone is a
zero-credential **demo simulator** (`/demo`) that runs a pasted PO through the full
pipeline (identify → extract → resolve → price → validate → decide) and shows the
would-be action, without sending email or submitting anything.

## Quick start

```bash
npm install
cp .env.example .env.local   # nothing required to run the offline tests
npm test                     # offline unit suites
npm run dev                  # http://localhost:3000
```

The feature is **off** until `PO_AGENT_ENABLED=true`.

## Architecture (short)

```
inbound email → dedupe → identify → AI extract → resolve SKUs + pricing →
  validate (B2B controls) → decide (quote vs order) → submit → reply
                     ↘ clarify (≤2 rounds) ↘ escalate (rep email + Slack + review queue)
```

- `lib/bc/*` — self-contained, session-less BigCommerce/B2B client layer (`StoreContext`).
- `lib/po-agent/*` — the pipeline: config, state, channels, AI, business core, escalation.
- `app/api/po-agent/*` — inbound webhooks, worker, cron.
- `app/staff/po-inbox` — review queue + demo simulator.

See `CLAUDE.md` for the working rules (BigCommerce docs MCP, single store token,
session-less design, offline-first testing).
