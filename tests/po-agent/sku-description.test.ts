import { describe, it, expect, afterEach } from "vitest";
import { checkSkuDescription, descriptionConflict, significantWords } from "@/lib/po-agent/core/sku-description";
import { heuristicExtract } from "@/lib/po-agent/ai/mock-provider";
import { decide } from "@/lib/po-agent/core/decide";
import { validate } from "@/lib/po-agent/core/validate";
import { replyTemplates } from "@/lib/po-agent/reply-templates";
import { processInbound, type PipelineDeps } from "@/lib/po-agent/pipeline";
import { SimulatorChannel } from "@/lib/po-agent/channel/simulator";
import { resolveExtractor } from "@/lib/po-agent/ai/extractor";
import { getPoAgentConfig } from "@/lib/po-agent/config";
import { createPoStore } from "@/lib/po-agent/store";
import type { Buyer, PoSession, ResolvedLine } from "@/lib/po-agent/types";
import { createMockRedis } from "@/tests/helpers/mock-redis";
import { installMockFetch, TEST_CTX } from "@/tests/helpers/mock-fetch";
import { termsReads } from "@/tests/helpers/bc-fixtures";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function line(over: Partial<ResolvedLine["line"]> = {}, res: Partial<ResolvedLine> = {}): ResolvedLine {
  return {
    line: { rawText: "x", sku: "ANS-GLV-NIT-XL", description: 'Sloan Check Valves 1" Sweat', quantity: 5, statedUnitPrice: null, statedTotal: null, ...over },
    productId: 7,
    variantId: 9,
    matchedSku: "ANS-GLV-NIT-XL",
    productName: "Ansell Nitrile Gloves, XL",
    issues: [],
    ...res,
  };
}

describe("descriptionConflict", () => {
  it("flags the POC bug: a check-valve description on a gloves SKU", () => {
    expect(descriptionConflict('Sloan Check Valves 1" Sweat', "Ansell Nitrile Gloves, XL", "ANS-GLV-NIT-XL")).toEqual({
      reason: "the description and the product name have no words in common",
    });
  });

  it("flags a different member of the same family even when other words match", () => {
    expect(descriptionConflict("3IN BALL VALVE CS 150", '3" Gate Valve, Carbon Steel, 150#')?.reason).toBe(
      'the buyer wrote "ball" but the product is "gate"',
    );
    expect(descriptionConflict("1/2 brass ball valve", "1/2\" Ball Valve, Bronze")?.reason).toMatch(/brass.*bronze/);
  });

  it.each([
    ["abbreviations", "1/2 NDL VLV 6000", '1/2" Needle Valve, 316 SS, 6000 PSI'],
    ["plurals", "Widgets", "Widget"],
    ["shared word, extra words", "Delta FlowGuard gate valves 3/8", "Gate Valve 3/8in"],
    ["spec shorthand only (nothing to compare)", "1/2 NPT SS", '1/2" Needle Valve'],
    ["sizes and numbers only", '3" 150#', "Gate Valve"],
    ["same family member", "knife gate valve", "Gate Valve, Knife, 4in"],
  ])("passes %s", (_label, description, name) => {
    expect(descriptionConflict(description, name)).toBeUndefined();
  });

  it("ignores the SKU's own words in the description", () => {
    expect(significantWords("GLV-NIT nitrile gloves", ["ANS-GLV-NIT-XL"])).toEqual(["nitrile", "glove"]);
  });
});

describe("checkSkuDescription", () => {
  it("adds the issue and the reason to a conflicting line, without mutating it", () => {
    const input = [line()];
    const [out] = checkSkuDescription(input);
    expect(out.issues).toEqual(["line_sku_description_conflict"]);
    expect(out.descriptionConflict).toMatch(/no words in common/);
    expect(input[0].issues).toEqual([]);
    expect(checkSkuDescription([out])[0].issues).toEqual(["line_sku_description_conflict"]); // idempotent
  });

  it.each([
    ["no buyer SKU", line({ sku: null }, { matchedSku: undefined })],
    ["no description", line({ description: null })],
    ["SKU didn't match", line({}, { matchedSku: undefined, productId: undefined, productName: undefined, issues: ["line_unresolved"] })],
    ["agreeing description", line({ description: "nitrile gloves XL" })],
  ])("leaves a line alone when there's %s", (_label, l) => {
    expect(checkSkuDescription([l])[0]).toBe(l);
  });
});

describe("a conflicting line goes to review, never through as ok", () => {
  const buyer = { email: "a@b.com", b2bUserId: 1, customerId: 2, companyId: 3, role: 1, companyName: "Acme" } as Buyer;

  it("is a blocking escalation", () => {
    const [l] = checkSkuDescription([line()]);
    const issues = validate({
      buyer,
      companyApproved: true,
      channelAmbiguous: false,
      channelAccessDenied: false,
      resolvedLines: [l],
      hasShipTo: true,
      multiCurrency: false,
      poNumberPresent: true,
      orderPathViable: true,
      payOnAccountReasons: [],
    });
    const conflict = issues.find((i) => i.kind === "line_sku_description_conflict")!;
    expect(conflict).toMatchObject({ blocking: true, lineRef: "ANS-GLV-NIT-XL", data: { description: 'Sloan Check Valves 1" Sweat', productName: "Ansell Nitrile Gloves, XL" } });
    const decision = decide({
      paymentIntent: "on_account",
      payOnAccountValid: true,
      buyerCanPlaceOrders: true,
      quoteEnabled: true,
      issues,
      clarificationRoundsExhausted: false,
    });
    expect(decision.kind).toBe("escalate");
  });

  it("offers staff a reply that quotes both sides", () => {
    const [l] = checkSkuDescription([line()]);
    const t = replyTemplates({ resolution: [l], extracted: null } as unknown as PoSession).find((x) => x.id === "ask_which_product");
    expect(t?.text).toContain("ANS-GLV-NIT-XL is our Ansell Nitrile Gloves, XL");
    expect(t?.text).toContain("“Sloan Check Valves 1\" Sweat”");
  });

  it("holds the session end to end, and the trail says why", async () => {
    installMockFetch(termsReads());
    const channel = new SimulatorChannel();
    const d: PipelineDeps = {
      ctx: TEST_CTX,
      config: getPoAgentConfig({ PO_AGENT_FIRST_ORDER_CONFIRM: "false" }),
      store: createPoStore(createMockRedis()),
      channel,
      extract: resolveExtractor({}),
      mailbox: "orders@supplier.com",
      now: () => "2026-10-13T12:00:00.000Z",
    };
    // WIDGET-100 is "Widget" in the fixtures; the buyer calls it gloves on the line above.
    const body = `PO Number: PO-7001
Please pay on account, net 30.

Nitrile exam gloves, large
SKU: WIDGET-100 Qty: 10
SKU: BOLT-250 Qty: 40 Bolt`;
    const session = await processInbound(d, channel.inject({ from: "buyer@acme.com", subject: "PO 7001", bodyText: body }), {});

    expect(session.extracted?.lines.map((l) => l.description)).toEqual(["Nitrile exam gloves, large", "Bolt"]);
    expect(session.resolution?.map((l) => l.issues)).toEqual([["line_sku_description_conflict"], []]);
    expect(session.state).toBe("escalated");

    const validated = session.audit.find((a) => a.event === "validated")!;
    expect(validated.outcome).toBe("flagged");
    expect(validated.summary).toContain('Line 1: SKU WIDGET-100 is "Widget", but the buyer wrote "Nitrile exam gloves, large"');
    expect(validated.summary).toContain("SKU and description disagree (line 1)");
    expect(validated.sources).toEqual([{ system: "bigcommerce", type: "product", id: "80", label: "Product · WIDGET-100", value: "Widget" }]);
  });
});

describe("heuristic extractor descriptions", () => {
  it("takes leftover words on the SKU line, or the plain line just above it", () => {
    const po = heuristicExtract({
      bodyText: `PO Number: PO-1624
Please pay using card

Sloan Check Valves 1" Sweat
SKU: ANS-GLV-NIT-XL   Qty: 5
SKU: BOLT-250 Qty: 40 $2.10
Hex bolts SKU: HEX-500 Qty: 12`,
    });
    expect(po.lines.map((l) => [l.sku, l.description])).toEqual([
      ["ANS-GLV-NIT-XL", 'Sloan Check Valves 1" Sweat'],
      ["BOLT-250", null],
      ["HEX-500", "Hex bolts"],
    ]);
  });

  it("never treats payment or PO-number lines as a description", () => {
    const po = heuristicExtract({ bodyText: "PO Number: PO-1\nPlease pay on account, net 30.\nSKU: W-1 Qty: 1" });
    expect(po.lines[0].description).toBeNull();
  });
});
