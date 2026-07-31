import { describe, it, expect, beforeAll } from "vitest";
import { getStoreContext, type StoreContext } from "@/lib/bc/store-context";
import { bcFetch } from "@/lib/bc/bc-client";
import { b2bFetch } from "@/lib/bc/b2b-client";
import { getPoAgentConfig } from "@/lib/po-agent/config";
import { identify } from "@/lib/po-agent/core/identify";
import { evaluate } from "@/lib/po-agent/pipeline";
import { submitQuote } from "@/lib/po-agent/core/submit-quote";
import { submitOrder, SANDBOX_NOTE } from "@/lib/po-agent/core/submit-order";
import type { ExtractedPo } from "@/lib/po-agent/types";

// ─────────────────────────────────────────────────────────────────────────────
// [L2] LIVE WRITE verification — plan §7 step L2.
//
// ⚠️  THIS CREATES REAL RECORDS IN THE CONNECTED STORE: one quote and one
//     pay-on-account order (plus its cart, checkout and B2B invoice).
//
// DOUBLE-GATED so it can never fire by accident — it needs BOTH:
//     PO_AGENT_LIVE=1  AND  PO_AGENT_LIVE_WRITE=1
// `npm test`, CI, and even the [L1] live run all skip it.
//
//   set -a; . ./.env.local; set +a
//   PO_AGENT_LIVE=1 PO_AGENT_LIVE_WRITE=1 npx vitest run tests/live/l2-write.test.ts
//
// Everything it creates is tagged with SANDBOX_NOTE ("[PO agent sandbox]") in
// staff_notes / quote notes so the artifacts are searchable and safe to delete.
// The created ids are printed at the end for cleanup.
// ─────────────────────────────────────────────────────────────────────────────

const LIVE =
  process.env.PO_AGENT_LIVE === "1" &&
  process.env.PO_AGENT_LIVE_WRITE === "1" &&
  Boolean(process.env.BIGCOMMERCE_STORE_HASH && process.env.BIGCOMMERCE_ACCESS_TOKEN);

const BUYER = "t.nguyen@pacific-elec.com";
const SKU = "LH-2X4-40LM-35K";

// Pacific Electrical Supply has NO stored company addresses, so the PO must carry both
// bill-to and ship-to. submitOrder falls back to company defaults only when the extraction
// omits them, and returns `missing_address` when neither exists. (Recorded in §7.2.)
const ADDRESS = {
  firstName: "Tam",
  lastName: "Nguyen",
  company: "Pacific Electrical Supply",
  line1: "4180 Kearny Mesa Rd",
  city: "San Diego",
  state: "California",
  zip: "92111",
  country: "US",
  phone: "6195550142",
  email: BUYER,
};

function poFixture(poNumber: string): ExtractedPo {
  return {
    poNumber,
    buyerNote: "Automated [L2] verification — safe to delete.",
    paymentIntent: "on_account",
    requestedShipDate: null,
    shipTo: ADDRESS,
    billTo: ADDRESS,
    lines: [
      { rawText: `SKU: ${SKU} Qty: 2`, sku: SKU, description: null, quantity: 2, statedUnitPrice: null, statedTotal: null },
    ],
    currency: null,
    confidence: "high",
  };
}

const created: string[] = [];

describe.skipIf(!LIVE)("[L2] live sandbox — WRITES real records", () => {
  let ctx: StoreContext;
  beforeAll(() => {
    ctx = getStoreContext();
  });

  it("creates a real quote with a working checkout link", async () => {
    const idres = await identify(ctx, BUYER);
    const poNumber = `PO-L2Q-${Date.now()}`;
    const { resolved, quoteConfig } = await evaluate(
      { ctx, config: getPoAgentConfig(process.env) },
      { idres, channelId: ctx.channelId, channelAmbiguous: false, channelAccessDenied: false, extracted: poFixture(poNumber), clarificationRounds: 0 },
    );
    expect(quoteConfig).toBeDefined();

    const res = await submitQuote(ctx, {
      buyer: idres.buyer!,
      channelId: ctx.channelId,
      resolvedLines: resolved,
      poNumber,
      expiryDays: 30,
      sandbox: true,
    });

    if (!res.ok) throw new Error(`submitQuote failed: ${res.reason}`);
    expect(res.quoteId).toBeGreaterThan(0);
    created.push(`quote ${res.quoteNumber ?? res.quoteId} (id ${res.quoteId})`);

    // The checkout link is the artifact the buyer actually receives.
    expect(res.checkoutUrl).toMatch(/^https?:\/\//);

    // Read it back: the quote must exist and carry our PO number as its reference.
    const raw = await b2bFetch<{ quoteNumber?: string; quoteReference?: string; quoteNotes?: string }>(
      ctx,
      `/rfq/${res.quoteId}`,
    );
    expect(String(raw.quoteReference ?? "")).toBe(poNumber);
    expect(String(raw.quoteNotes ?? "")).toContain(SANDBOX_NOTE.trim());
  }, 60_000);

  it("places a real pay-on-account order with invoice and B2B PO number", async () => {
    const idres = await identify(ctx, BUYER);
    const poNumber = `PO-L2O-${Date.now()}`;
    const extracted = poFixture(poNumber);
    const { resolved, decision, credit } = await evaluate(
      { ctx, config: getPoAgentConfig(process.env) },
      { idres, channelId: ctx.channelId, channelAmbiguous: false, channelAccessDenied: false, extracted, clarificationRounds: 0 },
    );
    // Guard: only proceed down the terms path if the pipeline actually chose it.
    expect(decision.kind).toBe("order");

    const res = await submitOrder(ctx, {
      buyer: idres.buyer!,
      channelId: ctx.channelId,
      resolvedLines: resolved,
      extracted,
      poNumber,
      credit: credit ? { limitPurchases: credit.limitPurchases, availableCredit: credit.availableCredit } : null,
      sandbox: true,
    });

    if (!res.ok) throw new Error(`submitOrder failed: ${res.reason}`);
    expect(res.orderId).toBeGreaterThan(0);
    created.push(`order #${res.orderId}`);

    expect(res.totals.grandTotal).toBeGreaterThan(0);

    // The order must actually read back as a terms order in BigCommerce.
    const order = await bcFetch<{ status_id: number; payment_method: string; staff_notes?: string; total_inc_tax: string }>(
      ctx,
      `/v2/orders/${res.orderId}`,
    );
    expect(order.status_id).toBe(11); // Awaiting Fulfillment
    expect(order.payment_method).toBe("Pay on Account");
    expect(order.staff_notes ?? "").toContain(poNumber);
    expect(order.staff_notes ?? "").toContain(SANDBOX_NOTE.trim());

    // B2B Edition side: canonical poNumber + invoice (headless orders aren't auto-invoiced).
    expect(["created", "exists"]).toContain(res.invoice.status);
    const b2bOrder = await b2bFetch<{ poNumber?: string; invoiceId?: number }>(ctx, `/orders/${res.orderId}`);
    expect(b2bOrder.poNumber).toBe(poNumber);
    expect(b2bOrder.invoiceId).toBeTruthy();
  }, 120_000);

  it("reports what it created (for cleanup)", () => {
    // Not an assertion so much as the run's receipt.
    console.log(`\n  [L2] created in store ${process.env.BIGCOMMERCE_STORE_HASH}:`);
    for (const c of created) console.log(`    · ${c}`);
    console.log(`  All tagged "${SANDBOX_NOTE.trim()}" — safe to delete.\n`);
    expect(created.length).toBe(2);
  });
});
