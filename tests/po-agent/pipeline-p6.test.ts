import { describe, it, expect, afterEach } from "vitest";
import { processInbound, type PipelineDeps } from "@/lib/po-agent/pipeline";
import { SimulatorChannel } from "@/lib/po-agent/channel/simulator";
import { resolveExtractor } from "@/lib/po-agent/ai/extractor";
import { getPoAgentConfig } from "@/lib/po-agent/config";
import { createPoStore, type PoStore } from "@/lib/po-agent/store";
import { createMockRedis } from "@/tests/helpers/mock-redis";
import { installMockFetch, TEST_CTX, type MockFetchController } from "@/tests/helpers/mock-fetch";
import { termsReads, orderWrites } from "@/tests/helpers/bc-fixtures";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const ORDER_PO = `PO Number: PO-5567
Please pay on account, net 30.
SKU: WIDGET-100 Qty: 10 $9.84
SKU: BOLT-250 Qty: 40`;

const NOW = "2026-07-23T12:00:00.000Z";

function deps(over: Partial<PipelineDeps> = {}): PipelineDeps {
  return {
    ctx: TEST_CTX,
    config: getPoAgentConfig({}),
    store: createPoStore(createMockRedis()),
    channel: new SimulatorChannel(),
    extract: resolveExtractor({}),
    now: () => NOW,
    ...over,
  };
}

const cartPosts = (m: MockFetchController) => m.calls.filter((c) => c.method === "POST" && c.url.includes("/v3/carts")).length;

describe("first-order confirmation gate (§7.8)", () => {
  it("holds the first order for CONFIRM, then becomes touchless", async () => {
    const mock = installMockFetch([...termsReads(), ...orderWrites()]);
    const channel = new SimulatorChannel();
    const store = createPoStore(createMockRedis());
    const d = deps({ channel, store }); // gate ON by default

    // 1) First PO from a new sender → awaiting confirmation, no order.
    const m1 = channel.inject({ from: "buyer@acme.com", subject: "PO", bodyText: ORDER_PO, threadId: "T1", messageId: "m1" });
    const s1 = await processInbound(d, m1, {});
    expect(s1.state).toBe("awaiting_confirmation");
    expect(channel.sent[0].reply.text).toContain("CONFIRM");
    expect(cartPosts(mock)).toBe(0);
    expect(await store.isTrusted("buyer@acme.com")).toBe(false);

    // 2) Buyer replies CONFIRM on the same thread → order placed, sender trusted.
    const m2 = channel.inject({ from: "buyer@acme.com", subject: "Re: PO", bodyText: "CONFIRM", threadId: "T1", messageId: "m2" });
    const s2 = await processInbound(d, m2, {});
    expect(s2.state).toBe("completed_order");
    expect(cartPosts(mock)).toBe(1);
    expect(await store.isTrusted("buyer@acme.com")).toBe(true);

    // 3) A later PO on a new thread is touchless.
    const m3 = channel.inject({ from: "buyer@acme.com", subject: "PO 2", bodyText: ORDER_PO, threadId: "T2", messageId: "m3" });
    const s3 = await processInbound(d, m3, {});
    expect(s3.state).toBe("completed_order");
    expect(cartPosts(mock)).toBe(2);
  });
});

describe("escalation decision", () => {
  it("escalates an unapproved company (queue + notice)", async () => {
    installMockFetch(termsReads({ approved: false }));
    const channel = new SimulatorChannel();
    const store = createPoStore(createMockRedis());
    const d = deps({ channel, store, config: getPoAgentConfig({ PO_AGENT_FIRST_ORDER_CONFIRM: "false" }) });
    const msg = channel.inject({ from: "buyer@acme.com", subject: "PO", bodyText: ORDER_PO });

    const session = await processInbound(d, msg, {});
    expect(session.state).toBe("escalated");
    expect(session.decision?.kind).toBe("escalate");
    expect(session.escalation?.reasons).toContain("company_not_approved");
    expect(session.escalation?.notified).toContain("queue");
    expect(await store.listQueue("escalated")).toContain(session.id);
    expect(channel.sent[0].reply.text).toContain("follow up");
  });
});

describe("triage of non-PO mail", () => {
  it("deflects a non-PO message once, without churning a session", async () => {
    installMockFetch(termsReads());
    const channel = new SimulatorChannel();
    const d = deps({ channel });
    const msg = channel.inject({ from: "buyer@acme.com", subject: "Question", bodyText: "Hi team, what's the status of my last order?" });

    const session = await processInbound(d, msg, {});
    expect(session.audit.some((a) => a.event === "triaged")).toBe(true);
    expect(channel.sent[0].reply.text).toContain("processes purchase orders");
  });
});

describe("clarification path", () => {
  it("asks for details on an unresolved SKU", async () => {
    installMockFetch(termsReads());
    const channel = new SimulatorChannel();
    const d = deps({ channel });
    const msg = channel.inject({ from: "buyer@acme.com", subject: "PO", bodyText: "PO Number: PO-9\nSKU: NOPE-999 Qty: 5" });

    const session = await processInbound(d, msg, {});
    expect(session.decision?.kind).toBe("clarify");
    expect(session.state).toBe("clarifying");
    expect(session.clarificationRounds).toBe(1);
    expect(channel.sent[0].reply.text).toContain("couldn't match this item");
  });
});

describe("daily submission cap", () => {
  it("escalates once the daily cap is exceeded", async () => {
    const mock = installMockFetch([...termsReads(), ...orderWrites()]);
    const channel = new SimulatorChannel();
    const store = createPoStore(createMockRedis());
    await store.bumpDailyCap("20260723", "submits"); // pre-seed at 1
    const d = deps({ channel, store, config: getPoAgentConfig({ PO_AGENT_FIRST_ORDER_CONFIRM: "false", PO_AGENT_DAILY_SUBMIT_CAP: "1" }) });
    const msg = channel.inject({ from: "buyer@acme.com", subject: "PO", bodyText: ORDER_PO });

    const session = await processInbound(d, msg, {});
    expect(session.state).toBe("escalated");
    expect(session.escalation?.reasons).toEqual(["daily_cap"]);
    expect(cartPosts(mock)).toBe(0);
  });
});
