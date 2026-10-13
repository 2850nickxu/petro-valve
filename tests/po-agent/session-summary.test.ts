import { describe, it, expect } from "vitest";
import { SUMMARY_VERSION, summaryOf, whyOf } from "@/lib/po-agent/session-summary";
import type { AuditEntry, PoSession, ResolvedLine, SessionMessage } from "@/lib/po-agent/types";

const AT = "2026-10-13T09:00:00.000Z";

function session(over: Partial<PoSession> = {}): PoSession {
  return {
    id: "google:T1",
    channel: "google",
    threadId: "T1",
    state: "escalated",
    clarificationRounds: 0,
    audit: [],
    messageIds: [],
    createdAt: AT,
    updatedAt: AT,
    ...over,
  };
}

function line(sku: string, issues: ResolvedLine["issues"] = []): ResolvedLine {
  return { line: { rawText: sku, sku, description: null, quantity: 1, statedUnitPrice: null, statedTotal: null }, matchedSku: sku, productId: 1, issues };
}

function msg(over: Partial<SessionMessage> & Pick<SessionMessage, "id">): SessionMessage {
  return { at: AT, direction: "out", audience: "buyer", kind: "auto_reply", status: "sent", subject: "Re: PO", text: "x", run: 1, ...over };
}

describe("whyOf", () => {
  it("uses the latest decide-stage step, so a held decision reads as held", () => {
    const audit: AuditEntry[] = [
      { at: AT, event: "decided", stage: "decide", run: 1, summary: "Place the order on account." },
      { at: AT, event: "outbound", stage: "outbound", run: 1, summary: "Sent the confirmation request." },
      { at: AT, event: "held", stage: "decide", run: 1, summary: "First order: asks the buyer to confirm." },
      { at: AT, event: "note", stage: "human", run: 1, summary: "Sales agent added an internal note." },
    ];
    expect(whyOf(session({ audit }))).toBe("First order: asks the buyer to confirm.");
  });

  it("lets a person's outcome action win, and reads legacy 'Staff' as Sales agent", () => {
    const audit: AuditEntry[] = [
      { at: AT, event: "decided", stage: "decide", run: 1, summary: "Hold for a person." },
      { at: AT, event: "dismissed", stage: "human", run: 1, actor: "staff", summary: "Staff dismissed the session." },
    ];
    expect(whyOf(session({ audit }))).toBe("Sales agent dismissed the session.");
  });

  it("falls back to the outcome summary for sessions from before decision steps", () => {
    const s = session({ decision: { kind: "escalate", reasons: ["daily_cap"] }, audit: [{ at: AT, event: "decided", detail: { kind: "escalate" } }] });
    expect(whyOf(s)).toBe("Today's automated processing limit was reached.");
  });
});

describe("summaryOf", () => {
  it("counts ready lines, customer emails in and out (not internal ones), and lists SKUs", () => {
    const s = session({
      buyer: { email: "ada@acme.com", companyName: "Acme", b2bUserId: 1, customerId: 2, companyId: 3, role: 1 },
      extracted: { poNumber: "PO-1", lines: [], paymentIntent: "on_account", requestedShipDate: null, shipTo: null, billTo: null, currency: null, confidence: "high", buyerNote: null },
      resolution: [line("A-1"), line("B-2", ["price_mismatch"]), line("A-1")],
      messages: [
        msg({ id: "m1", direction: "in", kind: "inbound", status: "received" }),
        msg({ id: "m2" }),
        msg({ id: "m3", audience: "internal", kind: "escalation_email" }),
        msg({ id: "m4", direction: "in", kind: "inbound", status: "received", run: 2 }),
      ],
    });
    expect(summaryOf(s)).toMatchObject({
      v: SUMMARY_VERSION,
      email: "ada@acme.com",
      company: "Acme",
      poNumber: "PO-1",
      linesReady: 2,
      linesTotal: 3,
      messagesIn: 2,
      messagesOut: 1,
      skus: ["A-1", "B-2"],
    });
  });

  it("identifies an unmatched customer by the sender's address", () => {
    const s = session({ state: "rejected", inbound: { from: "who@nowhere.com", subject: "PO", bodyText: "hi" } });
    expect(summaryOf(s)).toMatchObject({ email: "who@nowhere.com", company: "", messagesIn: 1, linesTotal: 0 });
  });
});
