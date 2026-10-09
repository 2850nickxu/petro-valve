import { describe, it, expect, afterEach } from "vitest";
import { processInbound, type PipelineDeps } from "@/lib/po-agent/pipeline";
import { sweepLifecycle } from "@/lib/po-agent/lifecycle";
import { recordInbound, recordedMailer, replyThread } from "@/lib/po-agent/messages";
import { SimulatorChannel } from "@/lib/po-agent/channel/simulator";
import type { OutboundReply, ThreadRef } from "@/lib/po-agent/channel/types";
import { resolveExtractor } from "@/lib/po-agent/ai/extractor";
import { getPoAgentConfig } from "@/lib/po-agent/config";
import { createPoStore } from "@/lib/po-agent/store";
import type { PoSession } from "@/lib/po-agent/types";
import { createMockRedis } from "@/tests/helpers/mock-redis";
import { installMockFetch, TEST_CTX, type MockRoute } from "@/tests/helpers/mock-fetch";
import { termsReads, orderWrites } from "@/tests/helpers/bc-fixtures";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const NOW = "2026-07-23T12:00:00.000Z";

const ORDER_PO = `PO Number: PO-5567
Please pay on account, net 30.
SKU: WIDGET-100 Qty: 10 $9.84
SKU: BOLT-250 Qty: 40`;

// Stated $5.00 is below the WIDGET-100 contract price of $9.84 (termsReads).
const BELOW_PO = `PO Number: PO-5567
Please pay on account, net 30.
SKU: WIDGET-100 Qty: 10 $5.00`;

const recipientRoutes: MockRoute[] = [
  { url: "/companies/123/super-admins", body: { code: 200, data: [{ id: 1, firstName: "Sam", email: "sam@rep.com" }] } },
  { url: "/users?companyId=123&roles=0", body: { code: 200, data: [{ id: 9, firstName: "Ada", email: "ada@acme.com", role: "0" }] } },
];

function deps(over: Partial<PipelineDeps> = {}): PipelineDeps {
  return {
    ctx: TEST_CTX,
    config: getPoAgentConfig({}),
    store: createPoStore(createMockRedis()),
    channel: new SimulatorChannel(),
    extract: resolveExtractor({}),
    mailbox: "orders@supplier.com",
    now: () => NOW,
    ...over,
  };
}

/** A simulator channel whose thread replies always fail, as a dead Gmail token would. */
class FailingChannel extends SimulatorChannel {
  async sendReply(_thread: ThreadRef, _reply: OutboundReply): Promise<{ messageId: string }> {
    void _thread;
    void _reply;
    throw new Error("token expired");
  }
}

describe("session message log", () => {
  it("keeps both runs of a thread on one session, with every body in and out", async () => {
    installMockFetch([...termsReads(), ...orderWrites()]);
    const channel = new SimulatorChannel();
    const store = createPoStore(createMockRedis());
    const d = deps({ channel, store }); // first-order confirmation ON: run 1 asks, run 2 orders

    const m1 = channel.inject({ from: "buyer@acme.com", subject: "PO 5567", bodyText: ORDER_PO, threadId: "T1", messageId: "g1" });
    m1.headers = { "message-id": "<g1@acme.com>" };
    await processInbound(d, m1, {});

    const m2 = channel.inject({ from: "buyer@acme.com", subject: "Re: PO 5567", bodyText: "CONFIRM", threadId: "T1", messageId: "g2" });
    m2.headers = { "message-id": "<g2@acme.com>", references: "<g1@acme.com>" };
    await processInbound(d, m2, {});

    const saved = await store.loadSession("simulator:T1");
    expect(saved?.state).toBe("completed_order");
    const log = saved!.messages!;
    expect(log.map((m) => [m.id, m.direction, m.kind, m.purpose ?? null, m.run])).toEqual([
      ["m1", "in", "inbound", null, 1],
      ["m2", "out", "auto_reply", "first_order_confirm", 1],
      ["m3", "in", "inbound", null, 2],
      ["m4", "out", "auto_reply", "order_confirmation", 2],
    ]);

    // Inbound: exact body, sender, mailbox and the RFC headers later replies thread on.
    expect(log[0]).toMatchObject({ from: "buyer@acme.com", to: "orders@supplier.com", text: ORDER_PO, status: "received", providerMessageId: "g1", rfcMessageId: "<g1@acme.com>" });
    expect(log[2]).toMatchObject({ text: "CONFIRM", references: "<g1@acme.com>" });

    // Outbound: the exact text that went to the channel, addressed to the buyer.
    expect(log[1].text).toBe(channel.sent[0].reply.text);
    expect(log[3].text).toBe(channel.sent[1].reply.text);
    expect(log[3]).toMatchObject({ audience: "buyer", to: "buyer@acme.com", from: "orders@supplier.com", subject: "Re: PO 5567", status: "captured", providerMessageId: channel.sent[1].messageId });
    expect(saved!.result?.confirmationMessageId).toBe(channel.sent[1].messageId);
  });

  it("logs rep-inbox escalations and below-contract forwards as internal messages", async () => {
    installMockFetch([...recipientRoutes, ...termsReads()]);
    const channel = new SimulatorChannel();
    const mailed: string[] = [];
    const d = deps({
      channel,
      config: getPoAgentConfig({
        PO_AGENT_FORWARD_PRICE_MISMATCH: "true",
        PO_AGENT_MAX_CLARIFICATIONS: "0",
        PO_AGENT_FIRST_ORDER_CONFIRM: "false",
        PO_AGENT_ESCALATION_EMAIL: "reps@supplier.com",
      }),
      sendMail: async (to) => {
        mailed.push(to);
        return true;
      },
    });

    const session = await processInbound(d, channel.inject({ from: "buyer@acme.com", subject: "PO 5567", bodyText: BELOW_PO }), {});

    expect(session.state).toBe("escalated");
    const out = session.messages!.filter((m) => m.direction === "out");
    expect(out.find((m) => m.audience === "buyer")?.purpose).toBe("escalation_notice");

    const internal = out.filter((m) => m.audience === "internal");
    expect(internal.map((m) => [m.kind, m.to]).sort()).toEqual([
      ["below_contract_forward", "ada@acme.com"],
      ["below_contract_forward", "sam@rep.com"],
      ["escalation_email", "reps@supplier.com"],
    ]);
    expect(mailed).toEqual(["reps@supplier.com"]);
    expect(internal.find((m) => m.kind === "escalation_email")?.text).toContain("A purchase order needs manual review.");
    expect(internal.find((m) => m.kind === "below_contract_forward")?.subject).toMatch(/below-contract/i);
  });

  it("records a failed reply as failed and carries on", async () => {
    installMockFetch(termsReads());
    const channel = new FailingChannel();
    const store = createPoStore(createMockRedis());
    const msg = channel.inject({ from: "buyer@acme.com", subject: "PO", bodyText: "PO Number: PO-9\nSKU: NOPE-999 Qty: 5" });

    const session = await processInbound(deps({ channel, store }), msg, {});

    // The pipeline still reached its decision instead of escalating as an internal error.
    expect(session.state).toBe("clarifying");
    expect(session.audit.some((a) => a.event === "error")).toBe(false);
    const sent = session.messages!.find((m) => m.direction === "out")!;
    expect(sent).toMatchObject({ purpose: "clarification", status: "failed", error: "token expired" });
    expect(sent.text).toContain("couldn't match this item");
    const failed = session.audit.find((a) => a.event === "send_failed");
    expect(failed?.detail).toMatchObject({ messageId: sent.id, purpose: "clarification", error: "token expired" });
    expect((await store.loadSession(session.id))?.messages).toHaveLength(2);
  });

  it("records a rejected internal email as failed", async () => {
    const session = { id: "simulator:x", audit: [], messages: [], messageIds: [] } as unknown as PoSession;
    const send = recordedMailer(async () => false, session, { kind: "escalation_email", captured: false }, () => NOW);

    expect(await send("reps@supplier.com", "Needs review", "body")).toBe(false);
    expect(session.messages![0]).toMatchObject({ audience: "internal", status: "failed", to: "reps@supplier.com" });
    expect(session.audit[0].event).toBe("send_failed");
  });

  it("logs a redelivered inbound message once", () => {
    const channel = new SimulatorChannel();
    const msg = channel.inject({ from: "buyer@acme.com", subject: "PO", bodyText: "x", threadId: "T9", messageId: "dup" });
    const session = { id: "simulator:T9", threadId: "T9", audit: [], messages: [], messageIds: [] } as unknown as PoSession;

    recordInbound(session, msg, NOW);
    recordInbound(session, msg, NOW);
    expect(session.messages).toHaveLength(1);
  });
});

describe("replies sent outside the pipeline", () => {
  function waiting(over: Partial<PoSession>): PoSession {
    return {
      id: "simulator:T1",
      channel: "simulator",
      threadId: "T1",
      state: "clarifying",
      clarificationRounds: 1,
      buyer: { email: "buyer@acme.com", b2bUserId: 1, customerId: 1, companyId: 1, role: 0, companyName: "Acme" },
      inbound: { from: "buyer@acme.com", subject: "PO 5567", bodyText: ORDER_PO },
      validation: [{ kind: "line_unresolved", message: "We couldn't match this item.", blocking: true }],
      audit: [],
      messageIds: ["g1", "g2"],
      createdAt: "2026-07-19T12:00:00.000Z",
      updatedAt: "2026-07-19T12:00:00.000Z", // 4 days before NOW ⇒ nudge
      ...over,
    };
  }

  it("threads a lifecycle nudge onto the buyer's newest message and logs it", async () => {
    const store = createPoStore(createMockRedis());
    const channel = new SimulatorChannel();
    const session = waiting({
      messages: [
        { id: "m1", at: NOW, direction: "in", audience: "buyer", kind: "inbound", status: "received", subject: "PO 5567", text: ORDER_PO, run: 1, providerMessageId: "g1", rfcMessageId: "<g1@acme.com>" },
        { id: "m2", at: NOW, direction: "in", audience: "buyer", kind: "inbound", status: "received", subject: "Re: PO 5567", text: "?", run: 2, providerMessageId: "g2", rfcMessageId: "<g2@acme.com>", references: "<g1@acme.com>" },
      ],
    });
    await store.saveSession(session);
    await store.enqueue("awaiting", session.id, 0);

    await sweepLifecycle({ config: getPoAgentConfig({}), store, channel, mailbox: "orders@supplier.com", now: () => NOW });

    expect(channel.sent[0].thread).toMatchObject({
      threadId: "T1",
      inReplyToMessageId: "g2",
      rfcMessageId: "<g2@acme.com>",
      references: "<g1@acme.com>",
      to: "buyer@acme.com",
      subject: "Re: PO 5567",
    });
    const saved = await store.loadSession(session.id);
    expect(saved?.messages?.[2]).toMatchObject({ id: "m3", kind: "reminder", text: channel.sent[0].reply.text, from: "orders@supplier.com" });
  });

  it("back-fills the original email on a session saved before the log existed", () => {
    const legacy = waiting({}); // no `messages`
    const thread = replyThread(legacy, "buyer@acme.com");

    expect(legacy.messages).toEqual([
      expect.objectContaining({ id: "m1", direction: "in", text: ORDER_PO, providerMessageId: "g1", run: 1 }),
    ]);
    expect(thread).toMatchObject({ inReplyToMessageId: "g1", subject: "Re: PO 5567" });
  });
});
