import { describe, it, expect, afterEach } from "vitest";
import { processInbound, type PipelineDeps } from "@/lib/po-agent/pipeline";
import { SimulatorChannel } from "@/lib/po-agent/channel/simulator";
import { resolveExtractor } from "@/lib/po-agent/ai/extractor";
import { getPoAgentConfig } from "@/lib/po-agent/config";
import { createPoStore, type PoStore } from "@/lib/po-agent/store";
import { submitQuote } from "@/lib/po-agent/core/submit-quote";
import { lineSummary } from "@/lib/po-agent/ai/respond";
import type { ResolvedLine } from "@/lib/po-agent/types";
import { createMockRedis } from "@/tests/helpers/mock-redis";
import { installMockFetch, TEST_CTX, type MockFetchController } from "@/tests/helpers/mock-fetch";
import { termsReads, orderWrites, quoteWrites } from "@/tests/helpers/bc-fixtures";

// How the pipeline behaves when something around a PO fails: an outage escalates instead
// of rejecting, a price the store didn't give is never used, and bookkeeping or a
// post-placement step can't undo a completed order.

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const ORDER_PO = `PO Number: PO-5567
Please pay on account, net 30.
SKU: WIDGET-100 Qty: 10 $9.84
SKU: BOLT-250 Qty: 40`;

function makeDeps(over: Partial<PipelineDeps> = {}): PipelineDeps {
  return {
    ctx: TEST_CTX,
    config: getPoAgentConfig({ PO_AGENT_FIRST_ORDER_CONFIRM: "false" }),
    store: createPoStore(createMockRedis()),
    channel: new SimulatorChannel(),
    extract: resolveExtractor({}),
    now: () => "2026-07-23T12:00:00.000Z",
    ...over,
  };
}

const submits = (mock: MockFetchController) =>
  mock.calls.filter((c) => c.method === "POST" && (c.url.includes("/v3/carts") || /\/rfq$/.test(c.url))).length;

const fail = () => Promise.reject(new Error("redis down"));

describe("BigCommerce outage", () => {
  it("escalates instead of telling a real buyer they're unknown", async () => {
    installMockFetch([{ url: "/users?email=", status: 500, body: { code: 500, message: "down" } }, ...termsReads()]);
    const channel = new SimulatorChannel();
    const msg = channel.inject({ from: "buyer@acme.com", subject: "New PO", bodyText: ORDER_PO });

    const session = await processInbound(makeDeps({ channel }), msg);

    expect(session.state).toBe("escalated");
    expect(session.escalation?.reasons).toEqual(["internal_error"]);
    expect(session.decision).toBeUndefined();
    expect(channel.sent).toHaveLength(0); // no rejection email
  });
});

describe("unpriced lines", () => {
  // The store prices WIDGET-100 but returns nothing for BOLT-250.
  const widgetOnly = {
    method: "POST",
    url: "/v3/pricing/products",
    body: {
      data: [{ product_id: 80, variant_id: 64, calculated_price: { as_entered: 9.84, tax_exclusive: 9.84, tax_inclusive: 10.6, entered_inclusive: false } }],
    },
  };

  it("escalate rather than order or quote at the PO's own price", async () => {
    const mock = installMockFetch([widgetOnly, ...termsReads(), ...orderWrites(), ...quoteWrites()]);
    const channel = new SimulatorChannel();
    const msg = channel.inject({ from: "buyer@acme.com", subject: "New PO", bodyText: ORDER_PO });

    const session = await processInbound(makeDeps({ channel }), msg);

    expect(session.state).toBe("escalated");
    expect(session.decision).toMatchObject({ kind: "escalate", reasons: ["line_unpriced"] });
    expect(session.validation?.find((v) => v.kind === "line_unpriced")).toMatchObject({ lineRef: "BOLT-250", blocking: true });
    expect(submits(mock)).toBe(0);
  });

  // A matched line the store didn't price, carrying a (suspiciously low) PO price.
  const unpriced: ResolvedLine = {
    line: { rawText: "BOLT-250 x 40", sku: "BOLT-250", description: null, quantity: 40, statedUnitPrice: 0.01, statedTotal: null },
    productId: 81,
    variantId: 810,
    matchedSku: "BOLT-250",
    issues: [],
  };

  it("are refused by submitQuote, which staff force-quote calls directly", async () => {
    installMockFetch([]); // any BigCommerce call would throw "no route matched"
    const res = await submitQuote(TEST_CTX, {
      buyer: { email: "buyer@acme.com", b2bUserId: 1, customerId: 42, companyId: 123, role: 1, companyName: "Acme" },
      channelId: 1,
      resolvedLines: [unpriced],
      expiryDays: 30,
    });
    expect(res).toEqual({ ok: false, reason: "line_unpriced" });
  });

  it("are listed without a price in buyer-facing copy", () => {
    expect(lineSummary([unpriced])).toBe("• 40 × BOLT-250");
  });
});

describe("after the order is placed", () => {
  it("keeps the order when marking it pay-on-account fails", async () => {
    installMockFetch([{ method: "PUT", url: "/v2/orders/9001", status: 500, body: "boom" }, ...termsReads(), ...orderWrites()]);
    const channel = new SimulatorChannel();
    const msg = channel.inject({ from: "buyer@acme.com", subject: "New PO", bodyText: ORDER_PO });

    const session = await processInbound(makeDeps({ channel }), msg);

    expect(session.state).toBe("completed_order");
    expect(session.result?.orderId).toBe(9001);
    const submitted = session.audit.find((a) => a.event === "submitted");
    expect(submitted?.summary).toMatch(/check it in BigCommerce/);
    expect(submitted?.detail).toMatchObject({ orderId: 9001, statusWarning: expect.stringMatching(/500/) });
  });

  it("stays completed when metrics, trust and lock bookkeeping fail", async () => {
    installMockFetch([...termsReads(), ...orderWrites()]);
    const base = createPoStore(createMockRedis());
    const store: PoStore = { ...base, bumpCounter: fail, setTrusted: fail, recordTokens: fail, releaseLock: fail };
    const channel = new SimulatorChannel();
    const msg = channel.inject({ from: "buyer@acme.com", subject: "New PO", bodyText: ORDER_PO });

    const session = await processInbound(makeDeps({ channel, store }), msg);

    expect(session.state).toBe("completed_order");
    expect(session.escalation).toBeUndefined();
    expect((await base.loadSession(session.id))?.state).toBe("completed_order");
  });
});

describe("session load failure", () => {
  it("escalates and saves nothing over the thread's real history", async () => {
    installMockFetch(termsReads());
    const base = createPoStore(createMockRedis());
    let saves = 0;
    const store: PoStore = {
      ...base,
      loadSession: fail,
      saveSession: async (s) => {
        saves += 1;
        await base.saveSession(s);
      },
    };
    const channel = new SimulatorChannel();
    const msg = channel.inject({ from: "buyer@acme.com", subject: "Re: PO", bodyText: ORDER_PO });

    const session = await processInbound(makeDeps({ channel, store }), msg);

    expect(session.state).toBe("escalated");
    expect(session.escalation?.reasons).toEqual(["internal_error"]);
    expect(session.audit.at(-1)).toMatchObject({ event: "error", stage: "received" });
    expect(saves).toBe(0);
    expect(channel.sent).toHaveLength(0);
    // The dedupe claim was released, so a later delivery of this message isn't skipped.
    expect(await base.claimMessage(channel.id, msg.messageId)).toBe(true);
  });
});
