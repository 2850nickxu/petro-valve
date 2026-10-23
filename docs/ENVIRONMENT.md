# Environment & secrets

Where configuration lives and which variable belongs where. **`.env.example` is
the source of truth** for the full list of keys — this doc explains *placement*
and the rules, not every key.

## The offline-first rule (do not break)

`npm test` and `npm run build` must need **zero** live credentials — this is the
CLAUDE.md "offline-first testing" invariant, and it's why CI runs credential-free.
The whole feature is inert until `PO_AGENT_ENABLED=true`. Never make a real secret
a build-time requirement; give anything the build touches a safe default.

## Where configuration lives

| Layer | Holds | Notes |
|---|---|---|
| **`.env.local`** (git-ignored) | Local-dev values | `cp .env.example .env.local`. `.gitignore` blocks `.env*` — never commit real secrets. Nothing is required to run the offline tests. |
| **Vercel project env** (`offline-po-app`) | Production + Preview runtime secrets | Set per-environment in the Vercel dashboard or via CLI (below). **This is where production reads from — never the repo.** |
| **In-app Settings** (encrypted at rest) | Store operator's self-service config | The `/staff` Settings UI; secrets are encrypted at rest. Lets an operator configure a store without a redeploy, consistent with the session-less, per-store design. |

## Vercel env — Preview vs Production

Preview deployments (every branch/PR) and Production (`main`) have **separate**
env stores. Set secrets for both, or previews run without them.

```bash
vercel env ls                          # list what's set, per environment
vercel env pull .env.local             # pull the Development env into a local file
vercel env add PO_AGENT_ENABLED production   # add/update a Production secret
vercel env add PO_AGENT_ENABLED preview      # ...and its Preview counterpart
vercel env rm  <NAME> production             # remove one
```

Keep production secrets out of git and out of `.env.example` (which stays blank +
documented). The `.vercelignore` already excludes `.env*` from deploys.

## Variable groups (full keys + comments in `.env.example`)

- **BigCommerce store context** — `BIGCOMMERCE_STORE_HASH`, `BIGCOMMERCE_ACCESS_TOKEN`
  (the single store token with **B2B Edition = modify**; there is no separate
  `B2B_*` token), `BIGCOMMERCE_CHANNEL_ID`.
- **Magento store context** (Petro Valve) — `MAGENTO_BASE_URL`, `MAGENTO_ADMIN_USERNAME`,
  `MAGENTO_ADMIN_PASSWORD`, `MAGENTO_GUEST_CART_WRITES`, read only through
  `lib/magento/magento-context.ts`. The store is **read-only** for this app except two
  guest-cart writes (create cart, add item), which stay off unless
  `MAGENTO_GUEST_CART_WRITES=true`.
- **PO agent core** — `PO_AGENT_ENABLED` / `PO_AGENT_MODE` / `PO_AGENT_CHANNEL`.
- **AI provider (BYO)** — `PO_AGENT_MODEL` + the matching provider key
  (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY` / Azure).
- **State** — Upstash Redis REST (`UPSTASH_REDIS_REST_URL` / `_TOKEN`; `KV_*` aliases ok).
- **Gmail channel** — `GOOGLE_PO_*` OAuth + Pub/Sub, `PO_AGENT_MAILBOX`, `PO_AGENT_INBOUND_SECRET`.
- **Microsoft channel** (optional) — `MS_PO_*`.
- **Guardrails / lifecycle / escalation** — the `PO_AGENT_*` tuning knobs.
- **Staff gate** — `PO_AGENT_STAFF_SECRET` (**required in production**; open in local dev when empty).

## Adding a new env var — checklist

1. Add it (blank, with a one-line comment) to **`.env.example`**.
2. Read it through the config layer / `StoreContext` — never `process.env.BIGCOMMERCE_*`
   inside `lib/bc/*` (keeps the session-less seam intact).
3. Set it in the Vercel project for **Production and Preview**.
4. If `test`/`build` touch it, give it a safe default so offline-first still holds.

See `docs/DEVOPS.md` for how code reaches those environments (the auto-ship pipeline).
