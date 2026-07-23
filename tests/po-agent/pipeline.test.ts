import { describe, it, expect, afterEach } from "vitest";
import { processInbound, type PipelineDeps } from "@/lib/po-agent/pipeline";
import { SimulatorChannel } from "@/lib/po-agent/channel/simulator";
import { resolveExtractor } from "@/lib/po-agent/ai/extractor";
import { getPoAgentConfig } from "@/lib/po-agent/config";
import { createPoStore } from "@/lib/po-agent/store";
import { createMockRedis } from "@/tests/helpers/mock-redis";
import { installMockFetch, TEST_CTX, type MockFetchController } from "@/tests/helpers/mock-fetch";
import { termsReads, orderWrites, quoteWrites } from "@/tests/helpers/bc-fixtures";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const ORDER_PO = `PO Number: PO-5567
Please pay on account, net 30.
SKU: WIDGET-100 Qty: 10 $9.84
SKU: BOLT-250 Qty: 40`;

const CARD_PO = `PO Number: PO-5568
We'll pay by credit card.
SKU: WIDGET-100 Qty: 10 $9.84`;

function makeDeps(over: Partial<PipelineDeps> = {}): PipelineDeps {
  return {
    ctx: TEST_CTX,
    config: getPoAgentConfig({}),
    store: createPoStore(createMockRedis()),
    channel: new SimulatorChannel(),
    extract: resolveExtractor({}), // heuristic (no PO_AGENT_MODEL)
    now: () => "2026-07-23T12:00:00.000Z",
    ...over,
  };
}

const cartPosts = (mock: MockFetchController) =>
  mock.calls.filter((c) => c.method === "POST" && c.url.includes("/v3/carts")).length;

describe("vertical slice (dry-run)", () => {
  it("runs identify→extract→resolve→price→validate→decide with no submit/email", async () => {
    const mock = installMockFetch(termsReads());
    const channel = new SimulatorChannel();
    const deps = makeDeps({ channel });
    const msg = channel.inject({ from: "buyer@acme.com", subject: "New PO", bodyText: ORDER_PO });

    const session = await processInbound(deps, msg, { dryRun: true });

    expect(session.decision?.kind).toBe("order");
    expect(session.state).toBe("validating");
    expect(session.resolution?.length).toBe(2);
    expect(session.validation).toEqual([]);
    expect(session.buyer?.companyName).toBe("Acme Industrial");
    // no submission, no reply
    expect(cartPosts(mock)).toBe(0);
    expect(channel.sent).toHaveLength(0);
    // audit trail is present
    expect(session.audit.map((a) => a.event)).toEqual(["identified", "extracted", "resolved", "decided"]);
  });
});

describe("auto-submit order", () => {
  it("places a terms order and replies with a confirmation", async () => {
    const mock = installMockFetch([...termsReads(), ...orderWrites()]);
    const channel = new SimulatorChannel();
    const deps = makeDeps({ channel });
    const msg = channel.inject({ from: "buyer@acme.com", subject: "New PO", bodyText: ORDER_PO });

    const session = await processInbound(deps, msg, {});

    expect(session.state).toBe("completed_order");
    expect(session.result?.orderId).toBe(9001);
    expect(cartPosts(mock)).toBe(1);
    expect(channel.sent).toHaveLength(1);
    expect(channel.sent[0].reply.text).toContain("Order #: 9001");
    expect(channel.sent[0].reply.text).toContain("PO-5567");
  });

  it("is idempotent under duplicate delivery (one order)", async () => {
    const mock = installMockFetch([...termsReads(), ...orderWrites()]);
    const channel = new SimulatorChannel();
    const store = createPoStore(createMockRedis());
    const deps = makeDeps({ channel, store });
    const msg = channel.inject({ from: "buyer@acme.com", subject: "New PO", bodyText: ORDER_PO, messageId: "dup-1" });

    await processInbound(deps, msg, {});
    const second = await processInbound(deps, msg, {}); // same messageId ⇒ deduped

    expect(cartPosts(mock)).toBe(1);
    expect(second.state).toBe("completed_order");
  });
});

describe("auto-submit quote (credit card)", () => {
  it("creates a quote and replies with a checkout link", async () => {
    installMockFetch([...termsReads(), ...quoteWrites()]);
    const channel = new SimulatorChannel();
    const deps = makeDeps({ channel });
    const msg = channel.inject({ from: "buyer@acme.com", subject: "Card order", bodyText: CARD_PO });

    const session = await processInbound(deps, msg, {});

    expect(session.state).toBe("completed_quote");
    expect(session.result?.quoteId).toBe(9001);
    expect(session.result?.checkoutUrl).toContain("/checkout?q=9001");
    expect(channel.sent[0].reply.text).toContain("Pay by card here");
  });
});

describe("unknown sender", () => {
  it("rejects politely without escalation spam", async () => {
    installMockFetch(termsReads({ usersEmpty: true }));
    const channel = new SimulatorChannel();
    const deps = makeDeps({ channel });
    const msg = channel.inject({ from: "stranger@nowhere.com", subject: "PO", bodyText: ORDER_PO });

    const session = await processInbound(deps, msg, {});

    expect(session.state).toBe("rejected");
    expect(session.decision?.kind).toBe("reject");
    expect(channel.sent).toHaveLength(1);
    expect(channel.sent[0].reply.text).toContain("couldn't match your email");
  });
});
