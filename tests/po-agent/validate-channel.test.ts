import { describe, it, expect } from "vitest";
import { validate, hasBlockingIssues, type ValidateInput } from "@/lib/po-agent/core/validate";
import { resolveChannel } from "@/lib/po-agent/core/channel";
import type { Buyer, ResolvedLine } from "@/lib/po-agent/types";

const buyer: Buyer = {
  email: "jane@acme.com",
  b2bUserId: 1,
  customerId: 42,
  companyId: 123,
  role: 1,
  companyName: "Acme",
  channelList: [1],
};

const resolvedLine = (over: Partial<ResolvedLine> = {}): ResolvedLine => ({
  line: { rawText: "WIDGET-100 x10", sku: "WIDGET-100", description: null, quantity: 10, statedUnitPrice: 9.84, statedTotal: null },
  productId: 80,
  variantId: 64,
  matchedSku: "WIDGET-100",
  issues: [],
  ...over,
});

const baseInput: ValidateInput = {
  buyer,
  companyApproved: true,
  channelAmbiguous: false,
  channelAccessDenied: false,
  resolvedLines: [resolvedLine()],
  hasShipTo: true,
  multiCurrency: false,
  poNumberPresent: true,
  orderPathViable: true,
  payOnAccountReasons: [],
};

describe("validate gauntlet", () => {
  it("passes a clean order", () => {
    expect(validate(baseInput)).toEqual([]);
  });

  it("unknown sender short-circuits", () => {
    const issues = validate({ ...baseInput, buyer: null });
    expect(issues.map((i) => i.kind)).toEqual(["unknown_sender"]);
  });

  it("flags an unapproved company", () => {
    expect(validate({ ...baseInput, companyApproved: false }).some((i) => i.kind === "company_not_approved")).toBe(true);
  });

  it("surfaces per-line issues with provenance and price data", () => {
    const issues = validate({
      ...baseInput,
      resolvedLines: [resolvedLine({ issues: ["price_mismatch"], calculatedUnitPrice: 9.84 })],
    });
    const pm = issues.find((i) => i.kind === "price_mismatch");
    expect(pm?.lineRef).toBe("WIDGET-100");
    expect(pm?.data).toMatchObject({ stated: 9.84, calculated: 9.84 });
  });

  it("adds line_unresolved when nothing is submittable", () => {
    const issues = validate({
      ...baseInput,
      resolvedLines: [resolvedLine({ productId: undefined, issues: ["line_unresolved"] })],
    });
    expect(issues.filter((i) => i.kind === "line_unresolved")).toHaveLength(1);
  });

  it("requires ship-to and PO number only on the order path", () => {
    expect(validate({ ...baseInput, hasShipTo: false }).some((i) => i.kind === "missing_ship_to")).toBe(true);
    expect(validate({ ...baseInput, poNumberPresent: false, orderPathViable: true }).some((i) => i.kind === "po_number_missing")).toBe(true);
    expect(validate({ ...baseInput, poNumberPresent: false, orderPathViable: false }).some((i) => i.kind === "po_number_missing")).toBe(false);
  });

  it("channel + currency + pay-on-account reasons become issues", () => {
    const issues = validate({
      ...baseInput,
      channelAccessDenied: true,
      channelAmbiguous: true,
      multiCurrency: true,
      payOnAccountReasons: ["credit_hold"],
    });
    const kinds = issues.map((i) => i.kind);
    expect(kinds).toContain("channel_access_denied");
    expect(kinds).toContain("channel_ambiguous");
    expect(kinds).toContain("multi_currency");
    expect(kinds).toContain("credit_hold");
    // credit_hold is non-blocking (decision routing), channel_access_denied blocks
    expect(hasBlockingIssues(issues)).toBe(true);
    expect(issues.find((i) => i.kind === "credit_hold")?.blocking).toBe(false);
  });
});

describe("resolveChannel (MSF §7.0)", () => {
  const cfg = { channelMap: { "poc@silk.com": 5 }, fallbackChannelId: 1 };

  it("mailbox map pins the channel when the buyer is assigned to it", () => {
    const r = resolveChannel({ ...cfg, mailbox: "poc@silk.com", buyer: { ...buyer, channelList: [5] } });
    expect(r).toEqual({ channelId: 5, ambiguous: false, accessDenied: false });
  });

  it("denies access when the mapped channel is not in the buyer's channelList", () => {
    const r = resolveChannel({ ...cfg, mailbox: "poc@silk.com", buyer: { ...buyer, channelList: [1, 2] } });
    expect(r.accessDenied).toBe(true);
  });

  it("uses the single assigned channel when no mailbox mapping", () => {
    const r = resolveChannel({ ...cfg, buyer: { ...buyer, channelList: [7] } });
    expect(r.channelId).toBe(7);
  });

  it("prefers the default channel among several, else flags ambiguous", () => {
    expect(resolveChannel({ ...cfg, buyer: { ...buyer, channelList: [1, 7] } }).channelId).toBe(1);
    const amb = resolveChannel({ ...cfg, buyer: { ...buyer, channelList: [7, 8] } });
    expect(amb.ambiguous).toBe(true);
  });

  it("falls back to the configured channel for single-storefront (no channelList)", () => {
    expect(resolveChannel({ ...cfg, buyer: { ...buyer, channelList: [] } }).channelId).toBe(1);
  });
});
