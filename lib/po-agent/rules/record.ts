import type { ExtractedPo, ResolvedLine } from "../types";
import { redactPaymentData } from "./classify";
import type { Classification, DecisionRecord, RulesOutcome } from "./types";

// The decision record (doc §7): one per inbound message. For an escalation it is also the
// handoff payload a person picks up. Built from validated data only; card and bank numbers
// are redacted from every text field when the message carried them (C8).

export interface RecordInput {
  messageId: string;
  threadId: string;
  run: number;
  at: string;
  outcome: RulesOutcome;
  classification: Classification;
  customer: { customerId: number | null; company: string | null; guest: boolean; name: string; email: string };
  extracted: ExtractedPo | null;
  resolved: ResolvedLine[];
  requestTotal: number;
  checkoutUrl: string | null;
  clarificationRoundsUsed: number;
  reply: { to: string; subject: string; body: string } | null;
  replyStatus: DecisionRecord["reply_status"];
}

export function buildDecisionRecord(r: RecordInput): DecisionRecord {
  const scrub = r.classification.paymentData ? redactPaymentData : (s: string) => s;
  const sent = r.replyStatus === "sent" && r.reply ? scrub(r.reply.body) : null;
  return {
    message_id: r.messageId,
    thread_id: r.threadId,
    action: r.outcome.action,
    matched_scenarios: [...new Set(r.outcome.scenarios.map((h) => h.id))],
    reason_codes: r.outcome.reasonCodes,
    intent: { type: r.classification.intent, confidence: r.classification.confidence },
    customer: {
      customer_id: r.customer.customerId != null ? String(r.customer.customerId) : null,
      company: r.customer.company,
      guest: r.customer.guest,
      name: r.customer.name,
      email: r.customer.email,
    },
    po_number: r.extracted?.poNumber ?? null,
    lines: r.resolved.map((l, i) => ({
      requested_text: scrub(l.line.rawText),
      matched_sku: l.matchedSku ?? null,
      match_confidence: l.productId != null && !l.parentSku ? 1 : 0,
      quantity: l.line.quantity,
      unit_price: l.calculatedUnitPrice ?? null,
      stock_on_hand: l.inventoryTracked ? (l.inventoryLevel ?? null) : null,
      line_status: r.outcome.lineStatuses[i] ?? "ok",
      scenario: r.outcome.lineScenarios[i] ?? "P1",
    })),
    request_total: Math.round(r.requestTotal * 100) / 100,
    checkout_url: r.checkoutUrl,
    clarification_rounds_used: r.clarificationRoundsUsed,
    reply: r.reply ? { ...r.reply, body: scrub(r.reply.body) } : null,
    already_sent_to_customer: sent,
    notes_for_rep: scrub(r.outcome.notesForRep),
    run: r.run,
    at: r.at,
    reply_status: r.replyStatus,
  };
}
