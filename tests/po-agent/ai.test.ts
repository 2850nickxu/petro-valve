import { describe, it, expect } from "vitest";
import { extractPo, ExtractedPoSchema } from "@/lib/po-agent/ai/extract";
import { buildAttachmentParts } from "@/lib/po-agent/ai/attachments";
import { heuristicExtract } from "@/lib/po-agent/ai/mock-provider";
import { getPoModel, hasConfiguredModel, poModel } from "@/lib/po-agent/ai/registry";
import { fixtureModel } from "@/tests/helpers/mock-ai";
import type { ExtractedPo } from "@/lib/po-agent/types";

const validPo: ExtractedPo = {
  poNumber: "PO-5567",
  buyerNote: null,
  paymentIntent: "on_account",
  requestedShipDate: null,
  shipTo: null,
  billTo: null,
  lines: [{ rawText: "SKU WIDGET-100 x10", sku: "WIDGET-100", description: null, quantity: 10, statedUnitPrice: 9.84, statedTotal: null }],
  currency: "USD",
  confidence: "high",
};

describe("extractPo via generateObject (schema-validated)", () => {
  it("returns the schema-valid object and attachment notes", async () => {
    const { extracted, notes } = await extractPo({
      model: fixtureModel(validPo),
      subject: "PO",
      bodyText: "please ship",
      attachments: [{ filename: "order.xlsx", mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", data: Buffer.from([1, 2, 3]) }],
    });
    expect(extracted.poNumber).toBe("PO-5567");
    expect(extracted.lines[0].sku).toBe("WIDGET-100");
    expect(notes[0]).toMatch(/spreadsheet/i);
    // sanity: the fixture itself satisfies the schema
    expect(ExtractedPoSchema.safeParse(extracted).success).toBe(true);
  });
});

describe("buildAttachmentParts", () => {
  it("passes pdf/image as file parts, csv as text, notes xlsx", () => {
    const { parts, notes } = buildAttachmentParts([
      { filename: "po.pdf", mediaType: "application/pdf", data: Buffer.from("x") },
      { filename: "lines.csv", mediaType: "text/csv", data: Buffer.from("sku,qty\nA,3") },
      { filename: "book.xlsx", mediaType: "application/vnd.ms-excel", data: Buffer.from([0]) },
    ]);
    expect(parts.find((p) => p.type === "file")).toBeTruthy();
    expect(parts.find((p) => p.type === "text" && p.text.includes("sku,qty"))).toBeTruthy();
    expect(notes).toHaveLength(1);
  });
});

describe("heuristicExtract (zero-cred fallback)", () => {
  it("parses PO number, payment intent, and SKU/qty/price lines", () => {
    const po = heuristicExtract({
      subject: "New order",
      bodyText: [
        "PO Number: PO-5567",
        "Please pay on account, net 30.",
        "SKU: WIDGET-100  Qty: 10  $9.84",
        "10 x BOLT-250 @ $2.10",
      ].join("\n"),
    });
    expect(po.poNumber).toBe("PO-5567");
    expect(po.paymentIntent).toBe("on_account");
    expect(po.currency).toBe("USD");
    expect(po.lines.map((l) => l.sku)).toEqual(["WIDGET-100", "BOLT-250"]);
    expect(po.lines[0].quantity).toBe(10);
    expect(po.lines[0].statedUnitPrice).toBe(9.84);
    expect(po.confidence).toBe("high");
    // the PO-number line must NOT become a line item
    expect(po.lines.some((l) => l.sku === "PO-5567")).toBe(false);
  });

  it("detects credit-card intent", () => {
    expect(heuristicExtract({ bodyText: "We'll pay by credit card. Item: ABC-1 Qty: 2" }).paymentIntent).toBe("credit_card");
  });

  it("falls back to a single low-confidence line when nothing parses", () => {
    const po = heuristicExtract({ bodyText: "Hi, can you tell me my account balance?" });
    expect(po.lines).toHaveLength(1);
    expect(po.confidence).toBe("low");
  });
});

describe("provider registry", () => {
  it("hasConfiguredModel + getPoModel gate on PO_AGENT_MODEL", () => {
    expect(hasConfiguredModel({})).toBe(false);
    expect(hasConfiguredModel({ PO_AGENT_MODEL: "anthropic:claude-x" })).toBe(true);
    expect(() => getPoModel({})).toThrow(/PO_AGENT_MODEL/);
  });

  it("resolves a provider:model id to a model object", () => {
    const model = poModel("anthropic:claude-sonnet-4-6");
    expect(model).toBeTruthy();
  });
});
