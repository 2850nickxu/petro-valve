## Summary

<!-- What does this PR do, and why? One or two sentences. -->

## Type of change

- [ ] `feat` — new functionality
- [ ] `fix` — bug fix
- [ ] `chore` / `docs` / `refactor` / `test` — no behavior change

## Checklist

- [ ] `npm run type-check`, `npm run lint`, `npm test`, and `npm run build` pass locally (CI enforces all four).
- [ ] **Offline-first preserved** — `tests`/`build` need no live credentials; new `lib/bc/*` calls route through the fetch wrappers and take a `StoreContext` (nothing reads `process.env.BIGCOMMERCE_*` directly).
- [ ] Any BigCommerce / B2B / Storefront-API claim is sourced from the **BigCommerce docs MCP** (`searchDocs`) and cited — not from model memory.
- [ ] No `B2B_*` token or legacy `authToken` introduced — B2B uses the single `BIGCOMMERCE_ACCESS_TOKEN`.
- [ ] **The model holds no write authority** — order/quote creation, replies, and state transitions stay code-driven; every number in outbound email comes from validated structured data.
- [ ] Env changes are reflected in `.env.example` + `docs/ENVIRONMENT.md`, and set in the Vercel project (never committed).

## Preview / verification

<!-- Vercel preview URL (auto-posted as a PR check) + how you verified the change. -->
