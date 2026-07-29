import type { DecisionKind, ValidationIssueKind } from "./types";
import { describeIssue } from "./core/validate";

// Turns a session's decision / escalation / validation into a plain-language "why" summary
// for the operator — so the review screen leads with a sentence, not a reason code. Pure.

const DECISION_REASON_TEXT: Record<string, string> = {
  pay_on_account: "Buyer is set up for pay-on-account terms.",
  credit_card: "Buyer asked to pay by credit card, so account terms don't apply.",
  no_terms: "Pay-on-account terms aren't available for this buyer.",
  buyer_role_requires_approval: "The buyer's role can't place orders directly — it needs approval.",
  quote: "Routed to a quote with a checkout link.",
  quote_feature_disabled: "Quotes aren't enabled for this account.",
  clarification_exhausted: "The buyer didn't resolve our questions within the allowed rounds.",
  daily_cap: "Today's automated processing limit was reached.",
  internal_error: "Something failed while processing — a human needs to look.",
};

const HEADLINE: Record<DecisionKind, string> = {
  order: "Ready to place as an order",
  quote: "Best handled as a quote",
  escalate: "Needs a human decision",
  clarify: "Waiting on the buyer to clarify",
  reject: "Not actionable — rejected",
};

function reasonText(reason: string): string {
  if (reason.startsWith("submit_failed:")) {
    return `Submission to BigCommerce failed (${reason.slice("submit_failed:".length)}).`;
  }
  if (reason in DECISION_REASON_TEXT) return DECISION_REASON_TEXT[reason];
  return describeIssue(reason as ValidationIssueKind);
}

export interface OutcomeSummary {
  headline: string;
  kind: DecisionKind | "pending";
  reasons: string[];
}

/** Structural input — satisfied by a full PoSession and by the simulator's lighter session
 * shape alike (the extra Escalation/ValidationIssue fields aren't read here). */
export interface OutcomeInput {
  decision?: { kind: DecisionKind; reasons: string[] };
  escalation?: { reasons: string[] };
  validation?: Array<{ message: string; blocking?: boolean }>;
}

export function summarizeOutcome(session: OutcomeInput): OutcomeSummary {
  const kind = session.decision?.kind;
  const raw = session.escalation?.reasons?.length ? session.escalation.reasons : session.decision?.reasons ?? [];
  const reasons = raw.map(reasonText);

  // If there were no decision reasons, fall back to blocking validation messages.
  if (!reasons.length && session.validation) {
    for (const v of session.validation) if (v.blocking) reasons.push(v.message);
  }

  return {
    headline: kind ? HEADLINE[kind] : "Awaiting evaluation",
    kind: kind ?? "pending",
    reasons: [...new Set(reasons)],
  };
}
