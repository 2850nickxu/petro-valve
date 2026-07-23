import { describe, it, expect } from "vitest";
import {
  draftClarification,
  draftOrderConfirmation,
  draftQuoteConfirmation,
  draftFirstOrderConfirm,
  lineSummary,
  money,
} from "@/lib/po-agent/ai/respond";
import type { ResolvedLine, ValidationIssue } from "@/lib/po-agent/types";

const resolved: ResolvedLine[] = [
  { line: { rawText: "WIDGET-100 x10", sku: "WIDGET-100", description: null, quantity: 10, statedUnitPrice: 9.84, statedTotal: null }, productId: 80, variantId: 64, matchedSku: "WIDGET-100", calculatedUnitPrice: 9.84, issues: [] },
];

describe("reply drafting (numbers from data only)", () => {
  it("money + lineSummary", () => {
    expect(money(9.8)).toBe("$9.80");
    expect(lineSummary(resolved)).toBe("• 10 × WIDGET-100 @ $9.84 = $98.40");
  });

  it("clarification bullets blocking issues", () => {
    const issues: ValidationIssue[] = [
      { kind: "missing_ship_to", message: "We need a shipping address.", blocking: true },
      { kind: "credit_hold", message: "on hold", blocking: false },
    ];
    const text = draftClarification(issues);
    expect(text).toContain("We need a shipping address.");
    expect(text).not.toContain("on hold");
  });

  it("order confirmation includes id, PO, and totals", () => {
    const text = draftOrderConfirmation({ orderId: 9001, poNumber: "PO-5567", resolved, totals: { subtotal: 98.4, shippingTotal: 15, taxTotal: 1, grandTotal: 114.4 } });
    expect(text).toContain("Order #: 9001");
    expect(text).toContain("PO #: PO-5567");
    expect(text).toContain("Total: $114.40");
  });

  it("quote confirmation includes the checkout link", () => {
    const text = draftQuoteConfirmation({ quoteNumber: "Q-1", resolved, checkoutUrl: "https://x/checkout", quoteUrl: "https://x/portal" });
    expect(text).toContain("Pay by card here: https://x/checkout");
    expect(text).toContain("Q-1");
  });

  it("first-order confirm asks for CONFIRM", () => {
    expect(draftFirstOrderConfirm(resolved, "$98.40")).toContain("Reply CONFIRM");
  });
});
