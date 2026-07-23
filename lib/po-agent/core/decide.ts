import type { Decision, PaymentIntent, ValidationIssue, ValidationIssueKind } from "../types";

// The quote-vs-order decision matrix (§7.4) and the pay-on-account / role helpers.
// Pure functions — no I/O — so the whole decision table is trivially unit-testable.

export type IssueCategory = "reject" | "escalate" | "clarify" | "decision" | "info";

export const ISSUE_CATEGORY: Record<ValidationIssueKind, IssueCategory> = {
  unknown_sender: "reject",
  company_not_approved: "escalate",
  quote_feature_disabled: "escalate",
  channel_access_denied: "escalate",
  daily_cap: "escalate",
  internal_error: "escalate",
  channel_ambiguous: "clarify",
  line_unresolved: "clarify",
  line_qty_bounds: "clarify",
  line_inventory_short: "clarify",
  price_mismatch: "clarify",
  missing_quantity: "clarify",
  missing_ship_to: "clarify",
  po_number_missing: "clarify",
  multi_currency: "clarify",
  line_blocked_by_assortment: "info",
  stale_thread: "info",
  payment_method_unavailable: "decision",
  credit_exceeded: "decision",
  credit_hold: "decision",
};

/** Category-derived "must resolve before submit" flag. */
export function isBlocking(kind: ValidationIssueKind): boolean {
  const c = ISSUE_CATEGORY[kind];
  return c === "reject" || c === "escalate" || c === "clarify";
}

/** Role gate: admins (0) and senior buyers (1) may place orders; others request quotes. */
export function buyerCanPlaceOrders(role: number): boolean {
  return role === 0 || role === 1;
}

export interface PayOnAccountInputs {
  methodAvailable: boolean;
  creditEnabled: boolean;
  creditHold: boolean;
  limitPurchases: boolean;
  estimatedTotal: number;
  availableCredit: number;
}

/** Evaluate pay-on-account validity; reasons map to decision-category issue kinds. */
export function assessPayOnAccount(p: PayOnAccountInputs): {
  valid: boolean;
  reasons: ValidationIssueKind[];
} {
  const reasons: ValidationIssueKind[] = [];
  if (!p.methodAvailable) reasons.push("payment_method_unavailable");
  if (p.creditEnabled && p.creditHold) reasons.push("credit_hold");
  if (p.limitPurchases && p.estimatedTotal > p.availableCredit) reasons.push("credit_exceeded");
  // No credit configured at all also disqualifies terms.
  if (!p.creditEnabled && !p.methodAvailable) {
    /* already captured by payment_method_unavailable */
  }
  return { valid: reasons.length === 0 && p.methodAvailable, reasons };
}

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

export interface DecideInput {
  paymentIntent: PaymentIntent;
  payOnAccountValid: boolean;
  buyerCanPlaceOrders: boolean;
  quoteEnabled: boolean;
  issues: ValidationIssue[];
  clarificationRoundsExhausted: boolean;
}

export function decide(input: DecideInput): Decision {
  const kinds = input.issues.map((i) => i.kind);

  // Hard stops.
  if (kinds.includes("unknown_sender")) return { kind: "reject", reasons: ["unknown_sender"] };

  const escalate = input.issues.filter(
    (i) => ISSUE_CATEGORY[i.kind] === "escalate" && i.kind !== "quote_feature_disabled",
  );
  if (escalate.length) return { kind: "escalate", reasons: uniq(escalate.map((i) => i.kind)) };

  // Buyer-fixable issues → clarify (or escalate once rounds are exhausted).
  const clarify = input.issues.filter((i) => ISSUE_CATEGORY[i.kind] === "clarify");
  if (clarify.length) {
    if (input.clarificationRoundsExhausted) {
      return { kind: "escalate", reasons: uniq(["clarification_exhausted", ...clarify.map((i) => i.kind)]) };
    }
    return { kind: "clarify", reasons: uniq(clarify.map((i) => i.kind)) };
  }

  // No blocking issues → order vs quote.
  const canOrder =
    input.payOnAccountValid &&
    input.buyerCanPlaceOrders &&
    (input.paymentIntent === "on_account" || input.paymentIntent === "unspecified");
  if (canOrder) return { kind: "order", reasons: ["pay_on_account"] };

  const reasons: string[] = [];
  if (input.paymentIntent === "credit_card") reasons.push("credit_card");
  if (!input.payOnAccountValid) reasons.push("no_terms");
  if (!input.buyerCanPlaceOrders) reasons.push("buyer_role_requires_approval");

  if (!input.quoteEnabled) {
    return { kind: "escalate", reasons: uniq(["quote_feature_disabled", ...reasons]) };
  }
  return { kind: "quote", reasons: reasons.length ? uniq(reasons) : ["quote"] };
}
