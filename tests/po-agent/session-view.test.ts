import { describe, it, expect, afterEach } from "vitest";
import { processInbound, type PipelineDeps } from "@/lib/po-agent/pipeline";
import { SimulatorChannel } from "@/lib/po-agent/channel/simulator";
import { resolveExtractor } from "@/lib/po-agent/ai/extractor";
import { getPoAgentConfig } from "@/lib/po-agent/config";
import { createPoStore } from "@/lib/po-agent/store";
import { conversationThread, decisionTrail, messageLabel, stamp, stepTitle } from "@/lib/po-agent/session-view";
import type { AuditEntry, PoSession, SessionMessage } from "@/lib/po-agent/types";
import { createMockRedis } from "@/tests/helpers/mock-redis";
import { installMockFetch, TEST_CTX } from "@/tests/helpers/mock-fetch";
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

function session(over: Partial<PoSession> = {}): PoSession {
  return {
    id: "google:T1",
    channel: "google",
    threadId: "T1",
    state: "escalated",
    clarificationRounds: 0,
    audit: [],
    messageIds: ["g1"],
    createdAt: "2026-10-01T09:00:00.000Z",
    updatedAt: "2026-10-01T09:05:00.000Z",
    ...over,
  };
}

function msg(over: Partial<SessionMessage> & Pick<SessionMessage, "id" | "at">): SessionMessage {
  return { direction: "in", audience: "buyer", kind: "inbound", status: "received", subject: "PO 1", text: "hello", run: 1, ...over };
}

describe("conversation thread and decision trail from a real pipeline run", () => {
  it("shows both runs of a thread in order, each email linked to the step that handled it", async () => {
    installMockFetch([...termsReads(), ...orderWrites()]);
    const channel = new SimulatorChannel();
    const store = createPoStore(createMockRedis());
    const d = deps({ channel, store }); // first-order confirmation ON: run 1 asks, run 2 orders

    await processInbound(d, channel.inject({ from: "buyer@acme.com", subject: "PO 5567", bodyText: ORDER_PO, threadId: "T1", messageId: "g1" }), {});
    await processInbound(d, channel.inject({ from: "buyer@acme.com", subject: "Re: PO 5567", bodyText: "CONFIRM", threadId: "T1", messageId: "g2" }), {});
    const saved = (await store.loadSession("simulator:T1"))!;

    // Every timestamp is the same here (fixed clock), so order comes from runs alone.
    const thread = conversationThread(saved);
    expect(thread.map((e) => (e.kind === "message" ? `${e.side}:${e.message.id}` : e.kind === "run" ? `run${e.run}` : e.kind))).toEqual([
      "customer:m1",
      "run1",
      "agent:m2",
      "customer:m3",
      "run2",
      "agent:m4",
    ]);

    // Each message points at a trail step that cites it.
    const trail = decisionTrail(saved);
    const steps = trail.flatMap((r) => r.steps);
    for (const e of thread) {
      if (e.kind !== "message") continue;
      expect(e.stepN, e.message.id).toBeDefined();
      const step = steps.find((s) => s.n === e.stepN)!;
      expect(step.sources.some((s) => s.type === "message" && s.id === e.message.id)).toBe(true);
    }

    // Run dividers carry how each run ended: held for first-order confirmation, then placed.
    const dividers = thread.filter((e) => e.kind === "run");
    expect(dividers.map((e) => e.kind === "run" && e.summary)).toEqual([
      expect.stringMatching(/first order/i),
      expect.stringMatching(/^Placed order #\d+/),
    ]);

    // Trail: one group per run, numbered across the whole session, with plain titles.
    expect(trail.map((r) => r.run)).toEqual([1, 2]);
    expect(trail[0].label).toBe(`Run 1 · New email · ${stamp(NOW)}`);
    expect(trail[1].label).toMatch(/^Run 2 · Buyer replied/);
    expect(steps.map((s) => s.n)).toEqual(steps.map((_, i) => i + 1));
    expect(steps[0]).toMatchObject({ title: "Received the email", stage: "Received" });
    expect(steps.every((s) => s.summary)).toBe(true);
  });
});

describe("conversationThread", () => {
  it("back-fills the original email for sessions saved before the message log", () => {
    const s = session({ inbound: { from: "a@b.com", subject: "PO 9", bodyText: "SKU X qty 1", receivedAt: "2026-10-01T09:00:00.000Z" } });
    const thread = conversationThread(s);
    expect(thread).toHaveLength(1);
    expect(thread[0]).toMatchObject({ kind: "message", side: "customer", message: { id: "m1", from: "a@b.com", text: "SKU X qty 1" } });
    expect(s.messages).toBeUndefined(); // read-only
  });

  it("is empty when nothing was stored", () => {
    expect(conversationThread(session())).toEqual([]);
  });

  it("places internal notes and internal emails by time, and splits sides", () => {
    const s = session({
      messages: [
        msg({ id: "m1", at: "2026-10-01T09:00:00.000Z" }),
        msg({ id: "m2", at: "2026-10-01T09:01:00.000Z", direction: "out", audience: "internal", kind: "escalation_email", status: "sent", to: "reps@x.com" }),
        msg({ id: "m3", at: "2026-10-01T09:10:00.000Z", direction: "out", kind: "staff_reply", status: "sent", actor: "staff" }),
      ],
      audit: [{ at: "2026-10-01T09:05:00.000Z", event: "note", note: "Called the buyer", actor: "staff", run: 1 }],
    });
    const thread = conversationThread(s);
    expect(thread.map((e) => (e.kind === "message" ? e.message.id : e.kind))).toEqual(["m1", "m2", "note", "m3"]);
    expect(thread.map((e) => (e.kind === "run" ? "run" : e.side))).toEqual(["customer", "internal", "internal", "agent"]);
    const note = thread[2];
    expect(note.kind === "note" && note.text).toBe("Called the buyer");
  });

  it("keeps only the last decide-stage step of a run (held, reprocess) as its divider", () => {
    const s = session({
      messages: [msg({ id: "m1", at: "2026-10-01T09:00:00.000Z" })],
      audit: [
        { at: "2026-10-01T09:00:01.000Z", event: "decided", stage: "decide", run: 1, summary: "Escalated." },
        { at: "2026-10-01T09:00:02.000Z", event: "outbound", stage: "outbound", run: 1, summary: "Sent a notice." },
        { at: "2026-10-01T10:00:00.000Z", event: "held", stage: "decide", run: 1, summary: "Quoted." },
      ],
    });
    const runs = conversationThread(s).filter((e) => e.kind === "run");
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ summary: "Quoted.", stepN: 3 });
  });
});

describe("decisionTrail", () => {
  it("groups legacy events without a run apart, and shortens their raw detail", () => {
    const audit: AuditEntry[] = [
      { at: "2026-10-01T09:00:00.000Z", event: "identified", detail: { companyId: 1, long: "x".repeat(400) } },
      { at: "2026-10-01T09:00:01.000Z", event: "dismissed", actor: "staff", note: "dup", run: 1, stage: "human", outcome: "rejected", summary: "Staff dismissed the session." },
    ];
    const trail = decisionTrail(session({ audit }));
    expect(trail.map((r) => r.run)).toEqual([null, 1]);
    expect(trail[0].label).toMatch(/^Earlier events/);
    expect(trail[0].steps[0].summary!.length).toBeLessThanOrEqual(161);
    expect(trail[0].steps[0].title).toBe("Identified the sender");
    expect(trail[1].steps[0]).toMatchObject({ n: 2, stage: "Person", note: "dup", actor: "staff", outcome: { label: "Rejected" } });
  });

  it("titles a failed send and unknown events sensibly", () => {
    expect(stepTitle({ event: "outbound", outcome: "failed" })).toBe("An email failed to send");
    expect(stepTitle({ event: "some_new_event" })).toBe("Some new event");
  });
});

describe("messageLabel", () => {
  it("names auto-replies by purpose and everything else by kind", () => {
    expect(messageLabel(msg({ id: "m", at: NOW, direction: "out", kind: "auto_reply", purpose: "clarification" }))).toBe("Clarifying question");
    expect(messageLabel(msg({ id: "m", at: NOW, direction: "out", kind: "reminder" }))).toBe("Reminder");
  });
});
