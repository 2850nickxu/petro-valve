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
  // The buyer's own words contradict the product their SKU matched: a person decides which
  // they meant, rather than the agent guessing or asking about a match it can't explain.
  line_sku_description_conflict: "escalate",
  // The store returned no price for a matched product. The buyer can't fix that, and the
  // PO's own price is never used in its place, so a person prices it.
  line_unpriced: "escalate",
  channel_ambiguous: "clarify",
  line_unresolved: "clarify",
  line_parent_sku: "clarify",
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

/**
 * Evaluate pay-on-account validity (plan §7.4): requires an enabled terms method AND the
 * B2B credit feature enabled AND not on hold AND within any credit limit. `reasons` map to
 * decision-category issue kinds that get surfaced; a disabled credit feature simply makes
 * pay-on-account invalid (routes to a quote as "no_terms") without a dedicated issue.
 */
export function assessPayOnAccount(p: PayOnAccountInputs): {
  valid: boolean;
  reasons: ValidationIssueKind[];
} {
  const reasons: ValidationIssueKind[] = [];
  if (!p.methodAvailable) reasons.push("payment_method_unavailable");
  if (p.creditEnabled && p.creditHold) reasons.push("credit_hold");
  if (p.limitPurchases && p.estimatedTotal > p.availableCredit) reasons.push("credit_exceeded");
  return { valid: reasons.length === 0 && p.methodAvailable && p.creditEnabled, reasons };
}

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

/**
 * Did the buyer, replying to a price-difference clarification, ask us to route the PO to
 * the sales team as a quote (for specialty pricing) rather than proceed at the contract
 * price? Deliberately narrow: the pipeline only consults this on a reply to a thread that
 * actually raised `price_mismatch`, so an original PO saying "please quote" can't trip it.
 */
const PRICE_REVIEW_RE =
  /\b(quote(?:\s+it)?|as\s+a\s+quote|special(?:ty|\s+)?pricing|sales\s+(?:team|review|rep)|review\s+(?:the\s+)?pricing)\b/i;

export function requestsPriceReview(body: string): boolean {
  return PRICE_REVIEW_RE.test(body);
}

const PRICE_ACCEPT_RE = /\b(confirm(?:ed|s)?|proceed|go\s+ahead|approved?|contract\s+price)\b/i;

/**
 * The other half of the price-difference offer: the buyer accepts the contract price.
 * A quote request wins if the reply somehow says both — routing to a human never places
 * an order the buyer didn't want.
 */
export function acceptsContractPrice(body: string): boolean {
  return !requestsPriceReview(body) && PRICE_ACCEPT_RE.test(body);
}

export interface DecideInput {
  paymentIntent: PaymentIntent;
  payOnAccountValid: boolean;
  buyerCanPlaceOrders: boolean;
  quoteEnabled: boolean;
  issues: ValidationIssue[];
  clarificationRoundsExhausted: boolean;
  /** Buyer replied to a price-difference clarification asking for a sales-reviewed quote. */
  priceReviewRequested?: boolean;
  /** Buyer replied to a price-difference clarification accepting the contract price. */
  priceAccepted?: boolean;
}

export function decide(input: DecideInput): Decision {
  const kinds = input.issues.map((i) => i.kind);

  // Hard stops.
  if (kinds.includes("unknown_sender")) return { kind: "reject", reasons: ["unknown_sender"] };

  const escalate = input.issues.filter(
    (i) => ISSUE_CATEGORY[i.kind] === "escalate" && i.kind !== "quote_feature_disabled",
  );
  if (escalate.length) return { kind: "escalate", reasons: uniq(escalate.map((i) => i.kind)) };

  // Buyer-fixable issues → clarify (or escalate once rounds are exhausted). A buyer who
  // has answered the price question — either way — has unblocked it: the quote (or their
  // acceptance of the contract price) IS the resolution, so it stops asking.
  const priceAnswered = Boolean(input.priceReviewRequested || input.priceAccepted);
  const clarify = input.issues
    .filter((i) => ISSUE_CATEGORY[i.kind] === "clarify")
    .filter((i) => !(priceAnswered && i.kind === "price_mismatch"));
  if (clarify.length) {
    if (input.clarificationRoundsExhausted) {
      return { kind: "escalate", reasons: uniq(["clarification_exhausted", ...clarify.map((i) => i.kind)]) };
    }
    return { kind: "clarify", reasons: uniq(clarify.map((i) => i.kind)) };
  }

  // Everything else is clear and the buyer wants sales to price it → quote, never an
  // order: placing one at the contract price would ignore what they just asked for.
  if (input.priceReviewRequested) {
    if (!input.quoteEnabled) {
      return { kind: "escalate", reasons: uniq(["quote_feature_disabled", "price_review_requested"]) };
    }
    return { kind: "quote", reasons: ["price_review_requested"] };
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
