# Petro Valve × Offline PO Agent: context for this repo

Paste this into a new Claude Code session in the `offline-po-app` repo (or save it there as a notes file). It summarizes what was learned and decided in the separate `petro-valve` project folder, as of 2026-10-18. No secrets are included; credentials live in that folder's `.env` and must be copied into this app's local env file by hand.

## What we're building

Petro Valve (Houston industrial valve distributor) is getting an AI quoting agent, Phase 1 of a fixed-fee Silk engagement (~6 weeks from the 10/12 kickoff). The agent reads quote requests from email (body text, PDF, Excel), matches the items to Petro Valve's web catalog, and either:

- **auto-quotes:** replies with a formal quote and a cart link on petrovalve.com, or
- **escalates:** creates a record in Petro Valve's HubSpot RFQ pipeline with full context, or
- **ignores:** spam, marketing, and requests clearly from outside the US/Canada.

We are building it by adapting the existing Offline PO Agent (this repo). That app was built for BigCommerce B2B Edition; Petro Valve runs **Magento**, so the commerce layer is new work.

## This week's tasks (from Chase)

1. **Run the model calls through AWS Bedrock** instead of the Anthropic API key, so we can compare models and bill through Silk's AWS. Nick has Bedrock access; still to confirm: region, which models are enabled, and IAM keys the app can use.
2. **Connect the agent to Magento and build a cart:** given parsed line items, find the products, get prices, and create a Magento guest cart with the items. Nothing about this involves AWS: the app calls Magento's REST API directly.

## Phase 1 business rules (kickoff 10/12 + recap email)

- Email-only agent. Inputs: the quotes inbox and HubSpot web forms. No website chatbot.
- Known and guest buyers get the **same pricing and the same response**. No contract pricing, credit, roles, or pay-on-account orders in Phase 1, so most of the B2B logic in this repo doesn't apply.
- Every auto-quote includes a formal quote **and** a cart link. When an existing customer logs in, the cart must carry over to their account so they can pay on credit.
- Descriptions or partial part numbers: offer the best match and say clearly that it's a recommendation for the customer to confirm.
- Escalate to the HubSpot RFQ pipeline when: the item isn't web-enabled (about 50% of requests), there's no confident match, the customer asks for a discount or an unusual quantity, the customer rejects the quote, or the customer replies with a purchase order.
- Persona: replies are signed **"Alex Bennett"** with a standard signature block.
- Geography: quote US and Canada only. Mexico is unclear (the recap excludes it, but it came up in the call); confirm with Petro Valve.
- No ERP (Epicor P21) access is needed or available.

## Magento facts (verified 2026-10-15/16)

- **Platform:** Magento 2 **Open Source** with Epicor Commerce Connect (47 `Epicor_*` modules). It is not Adobe Commerce, so there are no native B2B quote features. Also installed: 12 `Silk_*` modules, `Amasty_Acart` (abandoned-cart emails), and `Makewebbetter_HubIntegration` (HubSpot sync).
- **Environments:** prod `https://petrovalve.com`, test `https://petrovalve-test.epicorcommerce.com`. Admin path `/SiteAdmin`, REST at `/rest/V1/...`. Test data has drifted from prod (different prices, emptier categories).
- **Auth:** `POST /rest/V1/integration/admin/token` with `{"username","password"}` returns a bearer token. It expires after about 4 hours by default, so the client must re-authenticate on 401. For production, plan a scoped Magento Integration token. Note that Magento 2.4.4+ rejects integration tokens as bearer tokens unless an admin setting is enabled.
- **Catalog (prod):** 13,278 products: 1,630 configurable parents and 11,648 simple variants.
  - Parents have price 0 and aren't purchasable: SKU like `12111`, name like `VOGT GATE 800# A105 12111`.
  - Variants carry the price. SKU = 2-letter brand prefix + space + model + `-` + size in inches, often a fraction: `VO 12111-1`, `VO 12111-1-1/2`, `VO SW12141-3/4`, `CR 147XU-2`. Known prefixes: `VO` = Vogt, `CR` = Crane (others to confirm). Variant names often just repeat the SKU, and one has a name that doesn't match its SKU (`VO L12111FHF-2` is named `VO 12111FHF-2`).
  - Useful attributes for matching: `body_material`, `body_type`, `bonnet_type1/2`, `design`, `ecc_brand`, `VFN`, `description`.
  - **`cost` is returned by the API. Never expose it** in any reply, log shown to customers, or UI.
  - **$0.01 placeholder prices are common** (for example `VO 12111-3`, `VO 12111-1-1/4`, `VO SW12141-1-1/4`). Treat price ≤ $0.01 as a price anomaly and escalate.
  - Categories: brand groups (Vogt, Crane, Edward, Nibco, Aloyco…). Use SKU and attribute search for matching, not categories.
- **Endpoints already exercised (read-only):** `GET /V1/products` with `searchCriteria` (sku `like`, `type_id`, `price gt`, a `fields` filter), `GET /V1/categories`, `GET /V1/store/storeViews`, `GET /V1/customers/search` (count only), `GET /V1/modules`.
- **Cart endpoints to use:** `POST /V1/guest-carts` returns a masked cart id, then `POST /V1/guest-carts/{maskedId}/items` with `{"cartItem":{"sku","qty","quote_id":maskedId}}`, then `GET /V1/guest-carts/{maskedId}/totals`.

## Safety rules for Magento

- **Prod is read-only.** All cart writes go to the **test site** until Petro Valve and Chase sign off.
- Create **guest carts only**. Never use `/V1/customers/{id}/carts`: it returns and modifies the customer's real active cart.
- **Don't set an email on guest carts.** Abandoned-cart emails (Amasty) and the HubSpot cart sync are probably keyed on email.
- Before the first cart write on the test site, confirm its HubSpot integration doesn't point at Petro Valve's real HubSpot.
- Watch whether Epicor's add-ons react to API-created carts (for example ERP price or stock calls); that is part of what the test-site run is for.

## The cart link (not built yet, not this week's blocker)

Stock Magento can't open an API-created cart from an email link: the cart isn't attached to the customer's browser session. The Epicor Quick/Bulk Order Pads were checked and can't do it either, because their add-to-cart is a POST protected by a token tied to the visitor's session.

The plan is a small Silk Magento module: a URL like `petrovalve.com/<path>?cart=<maskedId>&exp=<ts>&sig=<HMAC>` that verifies the signature and expiry, loads the guest cart into the visitor's session, and redirects to `/checkout/cart`. Login then merges the guest cart into the customer's account cart (standard Magento behavior; to be verified, since Epicor may change it).

The agent side should already generate links in this format with an HMAC secret from env. Who can deploy modules to this store is still unconfirmed: it's probably Epicor-hosted, and Silk has deployed modules here before.

## Email (verified end-to-end 2026-10-16)

- Microsoft 365 via **Microsoft Graph**, app-only (client credentials). Entra app "PetroValve Quote Agent". Access is limited by Exchange RBAC to `quotes-test@petrovalve.com` only; the token has no tenant-wide roles. The live `quotes@` inbox is out of scope until Phase 2.
- Verified: reading folders and messages, downloading attachments (byte-identical), `sendMail`, and `/messages/{id}/reply`. Replies stay in the same `conversationId`.
- Petro Valve's mail system prepends a "CAUTION: External Email…" banner to external messages; strip it before parsing.
- Env values needed: tenant ID, client ID, client secret (in the petro-valve `.env` as `Tenant_ID`, `Application_ID`, `Client_Secret_Value`).
- Reference Python scripts from that work are in the petro-valve session scratchpad (`graph_common.py`, `graph_readonly.py`, `graph_inbound_reply.py`).

## HubSpot

- Web forms are HubSpot forms embedded on the site, so submissions come from HubSpot. Customer data also comes from HubSpot.
- Escalations go to the existing **RFQ pipeline**. They called it "tickets" in the call; confirm whether it's a tickets or a deals pipeline.
- The private app token is pending from Grant (due 10/16).

## Test data

In the petro-valve folder, `test-data/rfq-001/`:

- `BPS-RFQ-TEST-001.pdf`: 6 lines covering an exact SKU, a partial SKU, a description only, a $0.01 item, and a non-catalog item.
- `...-additional-items.xlsx`: 10 lines with SKU and size in separate columns, plus a quantity of 25,000 that should be escalated.
- `email_body.txt`: one more line in free text.
- `expected.json`: the correct SKU, price, and action for every line (prices from prod, 2026-10-16).

The company and contact are fictional; SKUs and prices are real.

## Suggested first steps in this repo

1. Run the app locally. Read `petrovalve-offline-po-decision-rules.md`, `lib/po-agent/rules`, and how the BigCommerce calls are wired (one module/interface, or spread out?).
2. Switch the model provider to Bedrock behind config.
3. Add a Magento commerce adapter covering only what Phase 1 needs:
   - auth with re-login on 401
   - SKU resolution (normalize brand prefix, spacing, and fraction formats)
   - variant price lookup, with ≤ $0.01 → escalate
   - guest cart create, add items, and read totals
   - signed link generation
4. Run the `rfq-001` kit: reads from prod, cart writes on the test site. Score the results against `expected.json`.

## Open questions

- Will Petro Valve get a separate deployment/branch of this app, or does Magento support go into the same app alongside BigCommerce?
- Hosting: the proposal says AWS, and the app currently runs on Vercel.
- Who deploys Magento modules, and through what process (Epicor hosting?)?
- Mexico in or out of scope; RFQ pipeline type; quote format (email body vs PDF).
