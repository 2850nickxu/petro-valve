import { describe, it, expect, beforeAll } from "vitest";
import { getStoreContext, type StoreContext } from "@/lib/bc/store-context";
import { getPoAgentConfig } from "@/lib/po-agent/config";
import { identify } from "@/lib/po-agent/core/identify";
import { evaluate } from "@/lib/po-agent/pipeline";
import { getCompanyPaymentMethods, hasEnabledPaymentCode } from "@/lib/bc/payments";
import { getCompanyCreditConfig } from "@/lib/bc/companies";
import { getProductPrices, priceKey } from "@/lib/bc/pricing";
import { resolveSkusToIds } from "@/lib/bc/sku-resolver";
import { assessPayOnAccount } from "@/lib/po-agent/core/decide";
import type { ExtractedPo } from "@/lib/po-agent/types";

// ─────────────────────────────────────────────────────────────────────────────
// [L1] LIVE sandbox verification — plan §7 step L1.
//
// This is the ONLY suite that talks to a real BigCommerce store. It is SKIPPED
// unless PO_AGENT_LIVE=1 is set AND store credentials are present, so `npm test`
// stays credential-free and offline (the repo's offline-first invariant).
//
//   set -a; . ./.env.local; set +a
//   PO_AGENT_LIVE=1 npx vitest run tests/live
//
// It is READ-ONLY: it never creates an order, quote, cart or checkout. The
// write-path proof is [L2], which is deliberately a separate, explicit step.
//
// Fixtures below are pinned to the "Catalyst B2B demo" sandbox (store ybhg7gjokp).
// If that store is reseeded these constants are what needs updating.
// ─────────────────────────────────────────────────────────────────────────────

const LIVE = process.env.PO_AGENT_LIVE === "1" && Boolean(process.env.BIGCOMMERCE_STORE_HASH && process.env.BIGCOMMERCE_ACCESS_TOKEN);

/** Approved company, customer group 5 (contract pricing), credit enabled. */
const BUYER_ADMIN = "t.nguyen@pacific-elec.com"; // role 0 → may place orders
const BUYER_JUNIOR = "k.larson@pacific-elec.com"; // role 2 → must be quoted
const COMPANY_ID = 12688405;
const CUSTOMER_GROUP = 5;

/** companyStatus=0 (not approved) — drives the company_not_approved path. */
const BUYER_UNAPPROVED = "j.okafor@bridgewater-elec.com";

/** A real, visible, priced SKU in the sandbox catalog. */
const SKU = "LH-2X4-40LM-35K";
const SKU_BASE_PRICE = 89.4;

function poFixture(over: Partial<ExtractedPo> = {}): ExtractedPo {
  return {
    poNumber: "PO-L1-VERIFY",
    buyerNote: null,
    paymentIntent: "on_account",
    requestedShipDate: null,
    shipTo: { line1: "4180 Kearny Mesa Rd", city: "San Diego", state: "CA", zip: "92111", country: "US" },
    billTo: null,
    lines: [{ rawText: `SKU: ${SKU} Qty: 4`, sku: SKU, description: null, quantity: 4, statedUnitPrice: null, statedTotal: null }],
    currency: null,
    confidence: "high",
    ...over,
  };
}

describe.skipIf(!LIVE)("[L1] live sandbox — read-only", () => {
  let ctx: StoreContext;
  beforeAll(() => {
    ctx = getStoreContext();
  });

  it("resolves a known buyer through identify()", async () => {
    const r = await identify(ctx, BUYER_ADMIN);
    expect(r.buyer).not.toBeNull();
    expect(r.buyer!.companyId).toBe(COMPANY_ID);
    expect(r.buyer!.customerId).toBeGreaterThan(0);
    expect(r.buyer!.role).toBe(0);
    expect(r.buyer!.customerGroupId).toBe(CUSTOMER_GROUP);
    expect(r.companyApproved).toBe(true);
  });

  it("rejects an unknown sender", async () => {
    const r = await identify(ctx, "definitely-not-a-buyer@example.invalid");
    expect(r.buyer).toBeNull();
    expect(r.issues).toContain("unknown_sender");
  });

  it("flags a company that isn't approved", async () => {
    const r = await identify(ctx, BUYER_UNAPPROVED);
    expect(r.buyer).not.toBeNull();
    expect(r.companyApproved).toBe(false);
    expect(r.issues).toContain("company_not_approved");
  });

  it("pins the pay-on-account payment code", async () => {
    const methods = await getCompanyPaymentMethods(ctx, COMPANY_ID);
    expect(methods.length).toBeGreaterThan(0);
    const configured = getPoAgentConfig(process.env).poPaymentCodes;
    // The configured code(s) must actually match something enabled on the company,
    // otherwise every PO silently routes to a quote as "no_terms".
    expect(hasEnabledPaymentCode(methods, configured)).toBe(true);
  });

  it("reads the company credit config", async () => {
    const credit = await getCompanyCreditConfig(ctx, COMPANY_ID);
    expect(credit).not.toBeNull();
    // Pay-on-account requires the B2B credit feature switched on for the company.
    expect(credit!.creditEnabled).toBe(true);
  });

  it("resolves the fixture SKU to a catalog product", async () => {
    const map = await resolveSkusToIds(ctx, [SKU]);
    expect(map.get(SKU)?.productId).toBeGreaterThan(0);
  });

  it("returns CONTRACT pricing for the company's group, not base", async () => {
    const map = await resolveSkusToIds(ctx, [SKU]);
    const hit = map.get(SKU)!;
    const items = [{ productId: hit.productId, variantId: hit.variantId }];

    const base = await getProductPrices(ctx, { items, channelId: ctx.channelId });
    const contract = await getProductPrices(ctx, { items, channelId: ctx.channelId, customerGroupId: CUSTOMER_GROUP });

    const basePrice = base.get(priceKey(hit.productId, hit.variantId))!.unitPrice;
    const contractPrice = contract.get(priceKey(hit.productId, hit.variantId))!.unitPrice;

    expect(basePrice).toBeCloseTo(SKU_BASE_PRICE, 2);
    // The whole value proposition: the group price must actually differ from base.
    expect(contractPrice).toBeLessThan(basePrice);
  });

  it("assesses pay-on-account as valid for the approved buyer", async () => {
    const [methods, credit] = await Promise.all([
      getCompanyPaymentMethods(ctx, COMPANY_ID),
      getCompanyCreditConfig(ctx, COMPANY_ID),
    ]);
    const assessment = assessPayOnAccount({
      methodAvailable: hasEnabledPaymentCode(methods, getPoAgentConfig(process.env).poPaymentCodes),
      creditEnabled: credit?.creditEnabled ?? false,
      creditHold: credit?.creditHold ?? false,
      limitPurchases: credit?.limitPurchases ?? false,
      estimatedTotal: 100,
      availableCredit: credit?.availableCredit ?? 0,
    });
    expect(assessment.reasons).toEqual([]);
    expect(assessment.valid).toBe(true);
  });

  it("evaluate() decides ORDER for an on-account PO from an admin buyer", async () => {
    const idres = await identify(ctx, BUYER_ADMIN);
    const result = await evaluate(
      { ctx, config: getPoAgentConfig(process.env) },
      { idres, channelId: ctx.channelId, channelAmbiguous: false, channelAccessDenied: false, extracted: poFixture(), clarificationRounds: 0 },
    );

    expect(result.resolved[0].productId).toBeGreaterThan(0);
    expect(result.resolved[0].calculatedUnitPrice).toBeGreaterThan(0);
    expect(result.issues.filter((i) => i.blocking)).toEqual([]);
    expect(result.decision.kind).toBe("order");
  });

  it("evaluate() decides QUOTE when the buyer asks to pay by card", async () => {
    const idres = await identify(ctx, BUYER_ADMIN);
    const result = await evaluate(
      { ctx, config: getPoAgentConfig(process.env) },
      { idres, channelId: ctx.channelId, channelAmbiguous: false, channelAccessDenied: false, extracted: poFixture({ paymentIntent: "credit_card" }), clarificationRounds: 0 },
    );
    expect(result.decision.kind).toBe("quote");
    expect(result.decision.reasons).toContain("credit_card");
  });

  it("evaluate() decides QUOTE for a junior buyer who can't place orders", async () => {
    const idres = await identify(ctx, BUYER_JUNIOR);
    expect(idres.buyer!.role).toBe(2);
    const result = await evaluate(
      { ctx, config: getPoAgentConfig(process.env) },
      { idres, channelId: ctx.channelId, channelAmbiguous: false, channelAccessDenied: false, extracted: poFixture(), clarificationRounds: 0 },
    );
    expect(result.decision.kind).toBe("quote");
    expect(result.decision.reasons).toContain("buyer_role_requires_approval");
  });

  it("evaluate() asks to CLARIFY an unknown SKU", async () => {
    const idres = await identify(ctx, BUYER_ADMIN);
    const result = await evaluate(
      { ctx, config: getPoAgentConfig(process.env) },
      {
        idres,
        channelId: ctx.channelId,
        channelAmbiguous: false,
        channelAccessDenied: false,
        extracted: poFixture({
          lines: [{ rawText: "2x PTFE envelope gasket 4in", sku: "DOES-NOT-EXIST-999", description: null, quantity: 2, statedUnitPrice: null, statedTotal: null }],
        }),
        clarificationRounds: 0,
      },
    );
    expect(result.decision.kind).toBe("clarify");
    expect(result.issues.some((i) => i.kind === "line_unresolved")).toBe(true);
  });
});
