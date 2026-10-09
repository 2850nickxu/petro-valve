import { describe, it, expect, afterEach } from "vitest";
import { processInbound, type PipelineDeps } from "@/lib/po-agent/pipeline";
import { SimulatorChannel } from "@/lib/po-agent/channel/simulator";
import { resolveExtractor } from "@/lib/po-agent/ai/extractor";
import { getPoAgentConfig } from "@/lib/po-agent/config";
import { createPoStore } from "@/lib/po-agent/store";
import { createMockRedis } from "@/tests/helpers/mock-redis";
import { installMockFetch, TEST_CTX, type MockRoute } from "@/tests/helpers/mock-fetch";
import { termsReads, quoteWrites } from "@/tests/helpers/bc-fixtures";

// End-to-end cover for the PO that slipped through: one child SKU priced below contract,
// one PARENT SKU. Neither may be submitted silently — the agent has to ask which version
// the buyer wants, and offer a sales-priced quote for the price difference.

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const PO = `PO Number: PO-5567
Please pay on account, net 30.

SKU: GE-T8-17W-41K   Qty: 10   $9.84
SKU: EA-EXEM-SR     Qty: 40`;

/** Catalog + pricing for the PO above; prepended so they win over the shared fixtures. */
function catalog(): MockRoute[] {
  return [
    {
      url: "/v3/catalog/variants?sku:in=",
      // Child SKUs resolve here directly — it's only the PARENT that the variants
      // endpoint can't match (docs: "to filter by product/base variant SKU, use products").
      body: (req: { url: string }) => ({
        data: [
          { id: 64, product_id: 80, sku: "GE-T8-17W-41K" },
          { id: 901, product_id: 90, sku: "EA-EXEM-SR-2FT" },
          { id: 902, product_id: 90, sku: "EA-EXEM-SR-4FT" },
        ].filter((v) => req.url.includes(encodeURIComponent(v.sku)) || req.url.includes(v.sku)),
      }),
    },
    {
      url: "/v3/catalog/products?sku:in=",
      body: {
        data: [
          {
            id: 90,
            sku: "EA-EXEM-SR",
            variants: [
              { id: 901, product_id: 90, sku: "EA-EXEM-SR-2FT", option_values: [{ option_display_name: "Length", label: "2 ft" }] },
              { id: 902, product_id: 90, sku: "EA-EXEM-SR-4FT", option_values: [{ option_display_name: "Length", label: "4 ft" }] },
            ],
          },
        ],
      },
    },
    {
      url: "/v3/catalog/products?id:in=",
      body: {
        data: [
          { id: 80, name: "GE T8 17W 4100K", sku: "GE-T8-17W-41K", is_visible: true, availability: "available", inventory_tracking: "none", inventory_level: 0, order_quantity_minimum: 0, order_quantity_maximum: 0 },
          { id: 90, name: "Exempt Series Retrofit", sku: "EA-EXEM-SR", is_visible: true, availability: "available", inventory_tracking: "variant", inventory_level: 500, order_quantity_minimum: 0, order_quantity_maximum: 0 },
        ],
      },
    },
    {
      method: "POST",
      url: "/v3/pricing/products",
      body: {
        data: [
          // Contract price is above the PO's $9.84 — a below-contract line.
          { product_id: 80, variant_id: 64, calculated_price: { as_entered: 11.2, tax_exclusive: 11.2, tax_inclusive: 12, entered_inclusive: false } },
          { product_id: 90, variant_id: 901, calculated_price: { as_entered: 18.4, tax_exclusive: 18.4, tax_inclusive: 19, entered_inclusive: false } },
          { product_id: 90, variant_id: 902, calculated_price: { as_entered: 24.75, tax_exclusive: 24.75, tax_inclusive: 26, entered_inclusive: false } },
        ],
      },
    },
  ];
}

function makeDeps(over: Partial<PipelineDeps> = {}): PipelineDeps {
  return {
    ctx: TEST_CTX,
    config: getPoAgentConfig({ PO_AGENT_FIRST_ORDER_CONFIRM: "false" }),
    store: createPoStore(createMockRedis()),
    channel: new SimulatorChannel(),
    extract: resolveExtractor({}),
    now: () => "2026-08-04T12:00:00.000Z",
    ...over,
  };
}

describe("parent SKU + price difference (the PO-5567 case)", () => {
  it("asks which version and offers a sales-priced quote instead of ordering", async () => {
    installMockFetch([...catalog(), ...termsReads()]);
    const channel = new SimulatorChannel();
    const deps = makeDeps({ channel });

    const session = await processInbound(deps, channel.inject({ from: "buyer@acme.com", subject: "New PO", bodyText: PO }), {});

    expect(session.decision?.kind).toBe("clarify");
    expect(session.state).toBe("clarifying");

    const kinds = session.validation?.map((v) => v.kind) ?? [];
    expect(kinds).toContain("line_parent_sku");
    expect(kinds).toContain("price_mismatch");

    // The parent line is resolved to a product but is NOT orderable.
    const parent = (session.resolution ?? []).find((r) => r.matchedSku === "EA-EXEM-SR")!;
    expect(parent.parentSku).toBe(true);
    expect(parent.variantId).toBeUndefined();
    expect(parent.variantChoices?.map((c) => c.sku)).toEqual(["EA-EXEM-SR-2FT", "EA-EXEM-SR-4FT"]);
    expect(parent.calculatedUnitPrice).toBeUndefined();

    // Nothing was submitted; the buyer got one email that asks both questions.
    expect(session.result?.orderId).toBeUndefined();
    expect(channel.sent).toHaveLength(1);
    const text = channel.sent[0].reply.text;
    expect(text).toContain("EA-EXEM-SR-2FT — Length: 2 ft — $18.40 ea");
    expect(text).toContain("EA-EXEM-SR-4FT — Length: 4 ft — $24.75 ea");
    expect(text).toContain("your PO says $9.84 ea, your contract price is $11.20 ea");
    expect(text).toContain("reply QUOTE");
    expect(text).toContain("specialty pricing");
  });

  it("submits a quote for sales review when the buyer replies QUOTE", async () => {
    installMockFetch([...catalog(), ...termsReads(), ...quoteWrites()]);
    const channel = new SimulatorChannel();
    const store = createPoStore(createMockRedis());
    const deps = makeDeps({ channel, store });

    const first = channel.inject({ from: "buyer@acme.com", subject: "New PO", bodyText: PO, messageId: "m1" });
    await processInbound(deps, first, {});

    // The buyer picks the 4 ft version AND asks for sales pricing.
    const reply = channel.inject({
      from: "buyer@acme.com",
      subject: "Re: New PO",
      threadId: first.threadId,
      messageId: "m2",
      bodyText: `${PO.replace("EA-EXEM-SR  ", "EA-EXEM-SR-4FT  ")}\n\nQUOTE please — have the sales team review the pricing.`,
    });
    const session = await processInbound(deps, reply, {});

    expect(session.decision?.kind).toBe("quote");
    expect(session.decision?.reasons).toEqual(["price_review_requested"]);
    expect(session.state).toBe("completed_quote");
    expect(session.audit.map((a) => a.event)).toContain("price_review_requested");
  });

  it("writes each run's decision steps, tagged with the run the inbound email started", async () => {
    installMockFetch([...catalog(), ...termsReads(), ...quoteWrites()]);
    const channel = new SimulatorChannel();
    const deps = makeDeps({ channel, store: createPoStore(createMockRedis()) });

    const first = channel.inject({ from: "buyer@acme.com", subject: "New PO", bodyText: PO, messageId: "m1" });
    await processInbound(deps, first, {});
    const reply = channel.inject({
      from: "buyer@acme.com",
      subject: "Re: New PO",
      threadId: first.threadId,
      messageId: "m2",
      bodyText: `${PO.replace("EA-EXEM-SR  ", "EA-EXEM-SR-4FT  ")}\n\nQUOTE please — have the sales team review the pricing.`,
    });
    const session = await processInbound(deps, reply, {});

    const run = (n: number) => session.audit.filter((a) => a.run === n).map((a) => a.event);
    expect(run(1)).toEqual(["received", "identified", "extracted", "resolved", "priced", "validated", "decided", "outbound"]);
    expect(run(2)).toEqual([
      "received", "identified", "extracted", "price_review_requested",
      "resolved", "priced", "validated", "decided", "submitted", "outbound",
    ]);
    for (const a of session.audit) {
      expect(a.stage).toBeDefined();
      expect(a.summary).toMatch(/\S/);
      expect(a.summary).not.toMatch(/undefined|NaN/);
    }

    // Run 1's price step keeps the numbers as read, even though run 2 overwrote the resolution.
    const priced = session.audit.find((a) => a.run === 1 && a.event === "priced")!;
    expect(priced.setting).toEqual({ key: "priceTolerancePct", label: "Price tolerance", value: "1%" });
    expect(priced.outcome).toBe("flagged");
    expect(priced.summary).toContain("Line 1: PO $9.84 vs store $11.20 (−12.1%), outside the 1% price tolerance.");
    expect((priced.detail as { lines: unknown[] }).lines[0]).toMatchObject({ line: 1, stated: 9.84, store: 11.2, diffPct: -12.1, withinTolerance: false });

    const resolved = session.audit.find((a) => a.run === 1 && a.event === "resolved")!;
    expect(resolved.summary).toBe("1 of 2 lines can be ordered. Matched by exact SKU: line 1. Parent SKU, version needed: line 2.");

    const decided = session.audit.find((a) => a.run === 1 && a.event === "decided")!;
    expect(decided.outcome).toBe("clarify");
    expect(decided.summary).toContain("Round 1 of 2.");

    // Each outbound step points at the logged message it describes, in the same run.
    for (const step of session.audit.filter((a) => a.event === "outbound")) {
      const id = (step.detail as { messageId: string }).messageId;
      const msg = session.messages!.find((m) => m.id === id)!;
      expect(msg.direction).toBe("out");
      expect(msg.run).toBe(step.run);
    }
    expect(session.audit.find((a) => a.run === 2 && a.event === "price_review_requested")?.outcome).toBe("resolved_by_buyer");
    expect(session.audit.find((a) => a.run === 2 && a.event === "received")?.summary).toBe("buyer@acme.com replied on the same thread.");
  });

  it("does not treat 'please quote' on the ORIGINAL PO as an answer to a price question", async () => {
    installMockFetch([...catalog(), ...termsReads()]);
    const channel = new SimulatorChannel();
    const deps = makeDeps({ channel });

    const session = await processInbound(
      deps,
      channel.inject({ from: "buyer@acme.com", subject: "New PO", bodyText: `${PO}\n\nPlease quote.` }),
      {},
    );

    // Still a clarification — we never raised the price question on this thread yet.
    expect(session.decision?.kind).toBe("clarify");
    expect(session.audit.map((a) => a.event)).not.toContain("price_review_requested");
  });
});
