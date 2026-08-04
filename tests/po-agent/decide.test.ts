import { describe, it, expect } from "vitest";
import {
  decide,
  assessPayOnAccount,
  buyerCanPlaceOrders,
  isBlocking,
  requestsPriceReview,
  acceptsContractPrice,
  type DecideInput,
} from "@/lib/po-agent/core/decide";
import type { ValidationIssue, ValidationIssueKind } from "@/lib/po-agent/types";

const issue = (kind: ValidationIssueKind): ValidationIssue => ({ kind, message: kind, blocking: true });

const base: DecideInput = {
  paymentIntent: "on_account",
  payOnAccountValid: true,
  buyerCanPlaceOrders: true,
  quoteEnabled: true,
  issues: [],
  clarificationRoundsExhausted: false,
};

describe("decide matrix", () => {
  it("rejects unknown sender", () => {
    expect(decide({ ...base, issues: [issue("unknown_sender")] }).kind).toBe("reject");
  });

  it("escalates company_not_approved", () => {
    expect(decide({ ...base, issues: [issue("company_not_approved")] }).kind).toBe("escalate");
  });

  it("clarifies buyer-fixable issues, then escalates once rounds exhausted", () => {
    expect(decide({ ...base, issues: [issue("line_unresolved")] }).kind).toBe("clarify");
    const esc = decide({ ...base, issues: [issue("line_unresolved")], clarificationRoundsExhausted: true });
    expect(esc.kind).toBe("escalate");
    expect(esc.reasons).toContain("clarification_exhausted");
  });

  it("clarifies a parent SKU rather than letting the line through", () => {
    expect(decide({ ...base, issues: [issue("line_parent_sku")] }).kind).toBe("clarify");
    expect(isBlocking("line_parent_sku")).toBe(true);
  });

  it("routes a buyer-requested price review to a quote, never an order", () => {
    const d = decide({ ...base, issues: [issue("price_mismatch")], priceReviewRequested: true });
    expect(d.kind).toBe("quote");
    expect(d.reasons).toEqual(["price_review_requested"]);
  });

  it("keeps clarifying when a price review can't answer the other open questions", () => {
    const d = decide({
      ...base,
      issues: [issue("price_mismatch"), issue("line_parent_sku")],
      priceReviewRequested: true,
    });
    expect(d.kind).toBe("clarify");
    expect(d.reasons).toEqual(["line_parent_sku"]);
  });

  it("escalates a price review when quotes are switched off", () => {
    const d = decide({
      ...base,
      quoteEnabled: false,
      issues: [issue("price_mismatch")],
      priceReviewRequested: true,
    });
    expect(d.kind).toBe("escalate");
    expect(d.reasons).toContain("quote_feature_disabled");
  });

  it("places the order at the contract price once the buyer accepts it", () => {
    const d = decide({ ...base, issues: [issue("price_mismatch")], priceAccepted: true });
    expect(d.kind).toBe("order");
  });

  it("places an order when terms valid, role ok, intent on_account/unspecified", () => {
    expect(decide({ ...base, paymentIntent: "on_account" }).kind).toBe("order");
    expect(decide({ ...base, paymentIntent: "unspecified" }).kind).toBe("order");
  });

  it("routes credit-card intent to a quote", () => {
    const d = decide({ ...base, paymentIntent: "credit_card" });
    expect(d.kind).toBe("quote");
    expect(d.reasons).toContain("credit_card");
  });

  it("routes to a quote when pay-on-account is invalid (no terms)", () => {
    const d = decide({ ...base, payOnAccountValid: false });
    expect(d.kind).toBe("quote");
    expect(d.reasons).toContain("no_terms");
  });

  it("downgrades to a quote when the buyer role can't place orders", () => {
    const d = decide({ ...base, buyerCanPlaceOrders: false });
    expect(d.kind).toBe("quote");
    expect(d.reasons).toContain("buyer_role_requires_approval");
  });

  it("escalates when a quote is needed but the quote feature is disabled", () => {
    const d = decide({ ...base, payOnAccountValid: false, quoteEnabled: false });
    expect(d.kind).toBe("escalate");
    expect(d.reasons).toContain("quote_feature_disabled");
  });

  it("treats decision-category issues (credit_exceeded) as quote routing, not clarify", () => {
    const d = decide({ ...base, payOnAccountValid: false, issues: [issue("credit_exceeded")] });
    expect(d.kind).toBe("quote");
  });
});

describe("assessPayOnAccount", () => {
  const ok = { methodAvailable: true, creditEnabled: true, creditHold: false, limitPurchases: false, estimatedTotal: 0, availableCredit: 0 };
  it("valid when a terms method is enabled and no credit blocks", () => {
    expect(assessPayOnAccount(ok).valid).toBe(true);
  });
  it("invalid on missing method / hold / exceeded", () => {
    expect(assessPayOnAccount({ ...ok, methodAvailable: false }).reasons).toContain("payment_method_unavailable");
    expect(assessPayOnAccount({ ...ok, creditHold: true }).reasons).toContain("credit_hold");
    expect(assessPayOnAccount({ ...ok, limitPurchases: true, estimatedTotal: 100, availableCredit: 50 }).reasons).toContain("credit_exceeded");
  });
  it("invalid when the B2B credit feature is disabled (§7.4)", () => {
    expect(assessPayOnAccount({ ...ok, creditEnabled: false }).valid).toBe(false);
  });
});

describe("buyerCanPlaceOrders + isBlocking", () => {
  it("admins and senior buyers can order; juniors cannot", () => {
    expect(buyerCanPlaceOrders(0)).toBe(true);
    expect(buyerCanPlaceOrders(1)).toBe(true);
    expect(buyerCanPlaceOrders(2)).toBe(false);
  });
  it("categorizes blocking vs non-blocking issue kinds", () => {
    expect(isBlocking("line_unresolved")).toBe(true);
    expect(isBlocking("company_not_approved")).toBe(true);
    expect(isBlocking("line_blocked_by_assortment")).toBe(false);
    expect(isBlocking("credit_exceeded")).toBe(false);
  });
});

describe("price-answer detection", () => {
  it("recognises a request for a sales-priced quote", () => {
    for (const body of [
      "QUOTE",
      "Please send it as a quote",
      "can your sales team review for specialty pricing?",
      "quote it please",
    ]) {
      expect(requestsPriceReview(body)).toBe(true);
      expect(acceptsContractPrice(body)).toBe(false);
    }
  });

  it("recognises acceptance of the contract price", () => {
    for (const body of ["CONFIRM", "confirmed, go ahead", "please proceed at the contract price"]) {
      expect(acceptsContractPrice(body)).toBe(true);
    }
  });

  it("prefers the quote route when a reply says both", () => {
    const body = "Confirmed on the parts, but please quote it for the sales team to review.";
    expect(requestsPriceReview(body)).toBe(true);
    expect(acceptsContractPrice(body)).toBe(false);
  });

  it("ignores unrelated replies", () => {
    expect(requestsPriceReview("Ship to the Denver dock.")).toBe(false);
    expect(acceptsContractPrice("Ship to the Denver dock.")).toBe(false);
  });
});
