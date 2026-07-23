# CLAUDE.md — offline-po-app

Standalone, email-first purchase-order processing agent for BigCommerce B2B Edition.
Turns emailed POs (PDF/CSV/text) into B2B **orders** (pay-on-account) or **quotes**
(with a checkout link), enforcing the same controls the storefront would. Design doc:
`docs/PO_AGENT.md` (operator runbook) and the approved build plan.

## Documentation source: BigCommerce docs MCP server ONLY

Any technical claim about BigCommerce, B2B Edition, or the Storefront/Management/GraphQL
APIs **must be sourced from the official BigCommerce documentation MCP server** — never
from model memory or a general web search.

- **Server:** `https://docs.bigcommerce.com/_mcp/server` (registered in `.mcp.json` →
  the `searchDocs` tool is available to any agent in this repo).
- **Rule:** Before asserting or coding against an endpoint, field, permission, limit, or
  behavior, query `searchDocs` and cite the `docs.bigcommerce.com/...` URL it returns.

## BigCommerce credentials: one store token (no separate B2B token)

There is **no separate B2B Edition API token**. B2B Edition uses the SAME store access
token as core BigCommerce — `BIGCOMMERCE_ACCESS_TOKEN`, sent as `X-Auth-Token` +
`X-Store-Hash` (see `lib/bc/b2b-client.ts`). That token needs the **B2B Edition** scope
set to `modify`. Do **not** introduce a `B2B_*_TOKEN` env var or the deprecated legacy
`authToken`.

## Session-less by design (StoreContext seam)

This is a standalone server-to-server app — there is **no buyer session**. Nothing in
`lib/bc/*` reads `process.env.BIGCOMMERCE_*` directly; it all takes a `StoreContext`
(`lib/bc/store-context.ts`). All B2B data is read via the Management API keyed by explicit
`companyId`/`customerId`. Keep it that way — it's what makes the code mockable and what
makes the future extraction into a per-store BigCommerce app (Phase B) turn-key.

## The model never holds write authority

Order/quote creation, reply sending, and state transitions are **code-driven**. The AI
model only extracts, matches, and drafts prose. Every number in an outbound email is
interpolated from validated structured data — never invented by the model. Email content
is untrusted input; the tool belt is read-only.

## Offline-first testing

Every phase must be buildable and unit-testable with **no** live credentials:
- `lib/bc/*` calls route through two fetch wrappers → stub with `tests/helpers/mock-fetch`.
- `lib/redis.ts` → `tests/helpers/mock-redis`.
- AI layer → the AI SDK mock model / `tests/helpers/mock-ai`.
Live BigCommerce/Gmail/AI verification lives in explicitly-labeled, skippable steps.

## Git workflow

- Base branch: `main`. Work on feature branches (`feat/…`, `fix/…`, `chore/…`).
- One clean, logically-scoped commit per phase; end messages with the standard
  `Co-Authored-By` trailer.
- Local commits only — do not push or open PRs unless asked (this repo has no remote yet).
- CI gate (when wired): `type-check` + `lint` + `test` + `build` must be green.

## Commands

```
npm run dev         # Next dev server
npm run build       # production build
npm run type-check  # tsc --noEmit
npm run lint        # eslint
npm test            # vitest run (offline unit suites)
```
