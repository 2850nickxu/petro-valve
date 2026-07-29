import type { Buyer, ResolvedLine, ValidationIssue, ValidationIssueKind } from "../types";
import { ISSUE_CATEGORY } from "./decide";

// The required-fields gauntlet (§7.3): assembles a ValidationIssue[] from already-gathered
// context. Pure — no I/O — so it is fully unit-testable as a decision table.

export const MESSAGES: Record<ValidationIssueKind, string> = {
  unknown_sender: "We couldn't match your email to a company account. Please contact your sales rep.",
  company_not_approved: "Your company account isn't active yet, so we can't process this order automatically.",
  channel_ambiguous: "Which storefront is this order for? Your account is linked to more than one.",
  channel_access_denied: "This order is for a storefront your account isn't set up to purchase from.",
  line_unresolved: "We couldn't match this item to a product in your catalog.",
  line_blocked_by_assortment: "This item isn't part of your company's assortment.",
  line_qty_bounds: "The quantity for this item is outside the allowed order limits.",
  line_inventory_short: "We don't currently have enough stock to fulfill this item.",
  price_mismatch: "The price on your PO differs from your contract price.",
  missing_quantity: "Please provide a quantity for this item.",
  missing_ship_to: "We need a shipping address to place this order.",
  payment_method_unavailable: "Pay-on-account isn't enabled for your company, so this will be sent as a quote.",
  credit_exceeded: "This order exceeds your available credit, so this will be sent as a quote.",
  credit_hold: "Your account is currently on credit hold, so this will be sent as a quote.",
  quote_feature_disabled: "Quotes aren't enabled for your account.",
  po_number_missing: "Please include a purchase-order number so we can place this order.",
  stale_thread: "This looks like a new PO on a completed thread; we've started a new order.",
  multi_currency: "This PO uses a currency we can't process automatically yet.",
  daily_cap: "We've reached today's automated processing limit; a team member will follow up.",
  internal_error: "Something went wrong on our side; a team member will follow up.",
};

/** Human-readable, buyer-safe description of a validation issue kind. */
export function describeIssue(kind: ValidationIssueKind): string {
  return MESSAGES[kind] ?? kind;
}

function issue(kind: ValidationIssueKind, lineRef?: string, data?: Record<string, unknown>): ValidationIssue {
  return {
    kind,
    message: MESSAGES[kind],
    lineRef,
    blocking: ISSUE_CATEGORY[kind] === "reject" || ISSUE_CATEGORY[kind] === "escalate" || ISSUE_CATEGORY[kind] === "clarify",
    data,
  };
}

export interface ValidateInput {
  buyer: Buyer | null;
  companyApproved: boolean;
  channelAmbiguous: boolean;
  channelAccessDenied: boolean;
  resolvedLines: ResolvedLine[];
  hasShipTo: boolean;
  multiCurrency: boolean;
  poNumberPresent: boolean;
  /** When true, a missing PO number is a blocker (order path); quotes don't require one. */
  orderPathViable: boolean;
  /** Reasons pay-on-account is (in)valid — surfaced as decision-category issues. */
  payOnAccountReasons: ValidationIssueKind[];
}

export function validate(input: ValidateInput): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!input.buyer) {
    return [issue("unknown_sender")];
  }
  if (!input.companyApproved) {
    issues.push(issue("company_not_approved"));
  }
  if (input.channelAccessDenied) issues.push(issue("channel_access_denied"));
  if (input.channelAmbiguous) issues.push(issue("channel_ambiguous"));

  // Per-line issues.
  for (const line of input.resolvedLines) {
    const ref = line.matchedSku ?? line.line.sku ?? line.line.rawText.slice(0, 60);
    for (const kind of line.issues) {
      issues.push(issue(kind, ref, kind === "price_mismatch" ? { stated: line.line.statedUnitPrice, calculated: line.calculatedUnitPrice } : undefined));
    }
  }

  // Are there any lines we could actually submit?
  const submittable = input.resolvedLines.filter(
    (l) => l.productId != null && !l.blockedByAssortment && !l.issues.includes("line_unresolved"),
  );
  if (input.resolvedLines.length > 0 && submittable.length === 0 && !issues.some((i) => i.kind === "line_unresolved")) {
    issues.push(issue("line_unresolved"));
  }

  if (!input.hasShipTo) issues.push(issue("missing_ship_to"));
  if (input.multiCurrency) issues.push(issue("multi_currency"));
  if (input.orderPathViable && !input.poNumberPresent) issues.push(issue("po_number_missing"));

  for (const kind of input.payOnAccountReasons) {
    if (!issues.some((i) => i.kind === kind)) issues.push(issue(kind));
  }

  return issues;
}

/** Convenience: does this issue set block automatic submission? */
export function hasBlockingIssues(issues: ValidationIssue[]): boolean {
  return issues.some((i) => i.blocking);
}
