# CLAUDE.md — offline-po-app

Standalone, email-first purchase-order processing agent for BigCommerce B2B Edition.
Turns emailed POs (PDF/CSV/text) into populated carts with checkout links, enforcing the same controls the storefront would. Design doc:
`docs/PO_AGENT.md` (operator runbook) and the approved build plan.

## Documentation source: BigCommerce docs MCP server ONLY

Any technical claim about BigCommerce, B2B Edition, or the Storefront/Management/GraphQL
APIs **must be sourced from the official BigCommerce documentation MCP server** — never
from model memory or a general web search.

- **Server:** `https://docs.bigcommerce.com/_mcp/server` (registered in `.mcp.json` →
  the `searchDocs` tool is available to any agent in this repo).
- **Rule:** Before asserting or coding against an endpoint, field, permission, limit, or behavior, query `searchDocs` and cite the `docs.bigcommerce.com/...` URL it returns.

## BigCommerce credentials: one store token (no separate B2B token)

There is **no separate B2B Edition API token**. B2B Edition uses the SAME store access
token as core BigCommerce — `BIGCOMMERCE_ACCESS_TOKEN`, sent as `X-Auth-Token` + `X-Store-Hash` (see `lib/bc/b2b-client.ts`). That token needs the **B2B Edition** scope set to `modify`. Do **not** introduce a `B2B_*_TOKEN` env var or the deprecated legacy`authToken`.

## Session-less by design (StoreContext seam)

This is a standalone server-to-server app — there is **no buyer session**. Nothing in`lib/bc/*` reads `process.env.BIGCOMMERCE_*` directly; it all takes a `StoreContext`(`lib/bc/store-context.ts`). All B2B data is read via the Management API keyed by explicit `companyId`/`customerId`. Keep it that way — it's what makes the code mockable and what makes the future extraction into a per-store BigCommerce app (Phase B) turn-key.

## Magento (Petro Valve): production store, read-only except guest carts

`lib/magento/*` talks to Petro Valve's **production** Magento 2 store. It may make exactly two writes — create a guest cart, add an item to it — through `magentoGuestCartPost()`, which is path-allow-listed and off unless `MAGENTO_GUEST_CART_WRITES=true`. Everything else is a GET (plus the admin-token login). Never touch customer carts (`/customers/{id}/carts`, `/carts/mine`), catalog, customers or orders, never PUT/DELETE, and never set an email on a guest cart (Amasty + HubSpot key on it) — `tests/magento/write-guard.test.ts` fails the build otherwise. Everything takes a `MagentoContext` (`lib/magento/magento-context.ts`), like `StoreContext` for BigCommerce. Product `cost` must never leave the layer: attributes pass through the `SAFE_ATTRIBUTES` allow-list in `lib/magento/types.ts`.

## UI — Backbone design system

The interface is built on the **Backbone design system**, vendored into the repo (there is
no npm package). Do **not** reintroduce `@bigcommerce/big-design*` or `styled-components`.

- **Components:** `components/backbone/*.tsx` — plain React, styled with inline styles that
  read CSS-variable tokens + `data-*` attributes (no CSS-in-JS runtime). Import from the
  barrel `@/components/backbone`. App-specific wrappers live in `components/ui/*` and
  `app/staff/ui.tsx`.
- **Tokens + base layer:** `styles/backbone/*.css`, imported once via `styles/backbone/index.css`
  in `app/layout.tsx`. Fonts (Inter + Roboto Mono) are self-hosted under
  `public/fonts/backbone/`.
- **Theme:** one product theme, set once on `<html data-accent="indigo">` (pure neutral) — the operations-console preset. The shell runs at `data-density="standard"`; data regions (inbox, sessions, usage tables) drop to `data-density="compact"` per region.
- **Rules that matter:** one 1px border weight; colour is a claim (signal tints only where attention is needed); accent = identity only (active nav, selected controls, focus, links), never status; Section/Panel/Inset — Section is the default, not everything is a card; one dominant action per task context; sentence case, no emoji. The five recipes
  (overview / worklist / record-detail / settings-form / onboarding) map to the screens.
- The full kit (readme, component contracts, prompt notes) is at
  `~/Downloads/Backbone Design System/` — consult it before adding UI, and keep any new component consistent with the vendored contracts (`.d.ts` shapes folded into each `.tsx`).

## Git workflow — isolated branches, auto-ship to production

`origin` is on GitHub and Vercel is wired to it: pushing any branch makes a
**preview** deploy; merging to `main` deploys **production**
(`https://offline-po-app.vercel.app`). CI (`type-check · lint · test · build`) gates every PR. Full runbook: `docs/DEVOPS.md`.

- **Isolation — never clobber another agent.** Each agent works in its OWN git worktree on its OWN branch, so parallel agents can't touch the same
  files/index. Spin one up with `scripts/new-agent-worktree.sh <slug>` (→ branch`agent/<slug>`), or use the Agent tool's `isolation: "worktree"`. Never work on `main`, and never commit onto a branch another agent is using. Branch off`origin/main` (`feat/…`, `fix/…`, `chore/…`, `agent/…`).
- **Commit + hand off.** One clean, logically-scoped commit (end messages with the standard `Co-Authored-By` trailer). On commit, `.githooks/post-commit` auto-launches `scripts/ship.sh` in the **background**: it pushes, opens/refreshes a PR, waits for CI + the Vercel preview to go green, **auto-merges to `main` (→ production)**, and watches the deploy — while your terminal moves to the next task. Enable the hook once per clone with `git config core.hooksPath .githooks` (the `prepare` npm script does this on `npm install`).
- **Escape hatches:** `[skip ship]` in a commit message, or `DEVOPS_AUTOSHIP=0`, commits without shipping; `SHIP_AUTOMERGE=0` stops at a green PR. On a red check the pipeline does NOT merge — hand the branch to the `devops` subagent (`.claude/agents/devops.md`) to triage, or read `.devops/FAILED-*.md`.
- The gate is enforced by the script + the `devops` agent (this private repo on a free plan can't use GitHub branch protection — see `docs/DEVOPS.md`).

## Commands

```
npm run dev         # Next dev server
npm run build       # production build
npm run type-check  # tsc --noEmit
npm run lint        # eslint
npm test            # vitest run (offline unit suites)
```
