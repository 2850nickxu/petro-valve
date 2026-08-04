import { describe, it, expect } from "vitest";
import { replyTemplates } from "@/lib/po-agent/reply-templates";
import type { PoSession, ResolvedLine, ValidationIssueKind } from "@/lib/po-agent/types";

// The reply templates are the one place operator-facing prose quotes figures back to the
// buyer, so these tests pin the invariant that every number comes from the resolution —
// never a literal in the copy.

function line(over: Partial<ResolvedLine> & { rawText?: string } = {}): ResolvedLine {
  const { rawText, ...rest } = over;
  return {
    line: {
      rawText: rawText ?? "SKU: WIDGET-100 Qty: 10 $9.84",
      sku: "WIDGET-100",
      description: null,
      quantity: 10,
      statedUnitPrice: 9.84,
      statedTotal: null,
      ...(rest.line ?? {}),
    },
    issues: [],
    ...rest,
  } as ResolvedLine;
}

function session(resolution: ResolvedLine[], currency?: string): PoSession {
  return {
    id: "simulator:t1",
    channel: "simulator",
    threadId: "t1",
    state: "escalated",
    clarificationRounds: 2,
    audit: [],
    messageIds: ["m1"],
    createdAt: "2026-07-29T09:38:00.000Z",
    updatedAt: "2026-07-29T09:42:00.000Z",
    resolution,
    extracted: {
      poNumber: "PO-5567",
      buyerNote: null,
      paymentIntent: "on_account",
      requestedShipDate: null,
      shipTo: null,
      billTo: null,
      lines: [],
      currency: currency ?? null,
      confidence: "medium",
    },
  };
}

const issues = (...ks: ValidationIssueKind[]) => ks;

describe("replyTemplates", () => {
  it("always offers a neutral holding note, even with no resolution", () => {
    const t = replyTemplates(session([]));
    expect(t).toHaveLength(1);
    expect(t[0].id).toBe("checking");
    expect(t[0].text).toContain("reviewing it now");
  });

  it("quotes the buyer's own wording for an unmatched line", () => {
    const t = replyTemplates(
      session([line({ rawText: "2x PTFE envelope gasket 4in", issues: issues("line_unresolved") })]),
    );
    const ask = t.find((x) => x.id === "ask_part_number")!;
    expect(ask.label).toBe("Ask for the part number");
    expect(ask.text).toContain("“2x PTFE envelope gasket 4in”");
  });

  it("pluralises when several lines are unmatched", () => {
    const t = replyTemplates(
      session([
        line({ rawText: "gasket A", issues: issues("line_unresolved") }),
        line({ rawText: "gasket B", issues: issues("line_unresolved") }),
      ]),
    );
    const ask = t.find((x) => x.id === "ask_part_number")!;
    expect(ask.label).toBe("Ask for the part numbers");
    expect(ask.text).toContain("“gasket A” and “gasket B”");
    expect(ask.text).toContain("these");
  });

  it("states both the PO price and the contract price on a mismatch", () => {
    const t = replyTemplates(
      session([
        line({
          matchedSku: "VLV-316-2IN",
          calculatedUnitPrice: 302.29,
          line: { rawText: "x", sku: "VLV-316-2IN", description: null, quantity: 12, statedUnitPrice: 318.2, statedTotal: null },
          issues: issues("price_mismatch"),
        }),
      ]),
    );
    const flag = t.find((x) => x.id === "flag_price")!;
    expect(flag.text).toContain("VLV-316-2IN");
    expect(flag.text).toContain("$318.20");
    expect(flag.text).toContain("$302.29");
    expect(flag.text).toContain("Reply CONFIRM");
    expect(flag.text).toContain("reply QUOTE");
    expect(flag.text).toContain("specialty pricing");
  });

  it("offers a sales-priced quote as its own template on a mismatch", () => {
    const t = replyTemplates(
      session([
        line({
          matchedSku: "VLV-316-2IN",
          calculatedUnitPrice: 302.29,
          line: { rawText: "x", sku: "VLV-316-2IN", description: null, quantity: 12, statedUnitPrice: 280, statedTotal: null },
          issues: issues("price_mismatch"),
        }),
      ]),
    );
    const offer = t.find((x) => x.id === "offer_price_review")!;
    expect(offer.text).toContain("$280.00");
    expect(offer.text).toContain("$302.29");
    expect(offer.text).toContain("reply QUOTE");
    expect(offer.text).toContain("sales team");
  });

  it("honours the extracted currency", () => {
    const t = replyTemplates(
      session(
        [
          line({
            matchedSku: "A-1",
            calculatedUnitPrice: 10,
            line: { rawText: "x", sku: "A-1", description: null, quantity: 1, statedUnitPrice: 12, statedTotal: null },
            issues: issues("price_mismatch"),
          }),
        ],
        "EUR",
      ),
    );
    const flag = t.find((x) => x.id === "flag_price")!;
    expect(flag.text).toContain("€12.00");
    expect(flag.text).toContain("€10.00");
  });

  it("offers a partial shipment using the real on-hand figure", () => {
    const t = replyTemplates(
      session([
        line({
          matchedSku: "BRG-SKF-6205",
          inventoryLevel: 18,
          line: { rawText: "x", sku: "BRG-SKF-6205", description: null, quantity: 24, statedUnitPrice: 16.58, statedTotal: null },
          issues: issues("line_inventory_short"),
        }),
      ]),
    );
    const partial = t.find((x) => x.id === "partial_shipment")!;
    expect(partial.text).toContain("18 of 24 on hand");
    expect(partial.text).toContain("backorder the remaining 6");
  });

  it("asks for a missing quantity by SKU", () => {
    const t = replyTemplates(
      session([
        line({
          matchedSku: "BOLT-250",
          line: { rawText: "SKU: BOLT-250", sku: "BOLT-250", description: null, quantity: null, statedUnitPrice: null, statedTotal: null },
          issues: issues("missing_quantity"),
        }),
      ]),
    );
    const ask = t.find((x) => x.id === "ask_quantity")!;
    expect(ask.text).toContain("BOLT-250");
  });

  it("stacks every applicable template plus the fallback", () => {
    const t = replyTemplates(
      session([
        line({ rawText: "mystery part", issues: issues("line_unresolved") }),
        line({
          matchedSku: "V-1",
          calculatedUnitPrice: 100,
          line: { rawText: "x", sku: "V-1", description: null, quantity: 2, statedUnitPrice: 110, statedTotal: null },
          issues: issues("price_mismatch"),
        }),
      ]),
    );
    expect(t.map((x) => x.id)).toEqual([
      "ask_part_number",
      "flag_price",
      "offer_price_review",
      "checking",
    ]);
  });

  it("lists the child variants and their prices for a parent SKU", () => {
    const t = replyTemplates(
      session([
        line({
          matchedSku: "EA-EXEM-SR",
          productName: "Exempt Series Retrofit",
          parentSku: true,
          variantChoices: [
            { variantId: 1, sku: "EA-EXEM-SR-2FT", optionLabel: "Length: 2 ft", unitPrice: 18.4 },
            { variantId: 2, sku: "EA-EXEM-SR-4FT", optionLabel: "Length: 4 ft", unitPrice: 24.75 },
          ],
          variantChoiceCount: 2,
          line: { rawText: "SKU: EA-EXEM-SR   Qty: 40", sku: "EA-EXEM-SR", description: null, quantity: 40, statedUnitPrice: null, statedTotal: null },
          issues: issues("line_parent_sku"),
        }),
      ]),
    );
    const ask = t.find((x) => x.id === "ask_variant")!;
    expect(ask.text).toContain("EA-EXEM-SR");
    expect(ask.text).toContain("Exempt Series Retrofit");
    expect(ask.text).toContain("parent part number");
    expect(ask.text).toContain("EA-EXEM-SR-2FT — Length: 2 ft — $18.40 ea");
    expect(ask.text).toContain("EA-EXEM-SR-4FT — Length: 4 ft — $24.75 ea");
  });

  it("summarises the tail when a parent has more versions than it lists", () => {
    const choices = Array.from({ length: 12 }, (_, i) => ({ variantId: i + 1, sku: `P-${i + 1}` }));
    const t = replyTemplates(
      session([
        line({
          matchedSku: "P",
          parentSku: true,
          variantChoices: choices,
          variantChoiceCount: 12,
          line: { rawText: "P", sku: "P", description: null, quantity: 1, statedUnitPrice: null, statedTotal: null },
          issues: issues("line_parent_sku"),
        }),
      ]),
    );
    const ask = t.find((x) => x.id === "ask_variant")!;
    expect(ask.text).toContain("P-8");
    expect(ask.text).not.toContain("P-9");
    expect(ask.text).toContain("and 4 more");
  });

  it("never invents a figure — an unpriced mismatch renders an em dash, not a number", () => {
    const t = replyTemplates(
      session([
        line({
          matchedSku: "NO-PRICE",
          calculatedUnitPrice: undefined,
          line: { rawText: "x", sku: "NO-PRICE", description: null, quantity: 1, statedUnitPrice: null, statedTotal: null },
          issues: issues("price_mismatch"),
        }),
      ]),
    );
    const flag = t.find((x) => x.id === "flag_price")!;
    expect(flag.text).toContain("—");
    expect(flag.text).not.toMatch(/\$\d/);
  });
});
