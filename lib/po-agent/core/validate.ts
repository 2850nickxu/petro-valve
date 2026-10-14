import type { Buyer, ResolvedLine, ValidationIssue, ValidationIssueKind } from "../types";
import { ISSUE_CATEGORY } from "./decide";
import { submittableLines } from "./resolve";

// The required-fields gauntlet (§7.3): assembles a ValidationIssue[] from already-gathered
// context. Pure — no I/O — so it is fully unit-testable as a decision table.

export const MESSAGES: Record<ValidationIssueKind, string> = {
  unknown_sender: "We couldn't match your email to a company account. Please contact your sales rep.",
  company_not_approved: "Your company account isn't active yet, so we can't process this order automatically.",
  channel_ambiguous: "Which storefront is this order for? Your account is linked to more than one.",
  channel_access_denied: "This order is for a storefront your account isn't set up to purchase from.",
  line_unresolved: "We couldn't match this item to a product in your catalog.",
  line_parent_sku:
    "This is a parent part number — it comes in more than one version, so we need to know which one you want.",
  line_blocked_by_assortment: "This item isn't part of your company's assortment.",
  line_qty_bounds: "The quantity for this item is outside the allowed order limits.",
  line_inventory_short: "We don't currently have enough stock to fulfill this item.",
  line_sku_description_conflict: "The part number and the description for this item point to different products.",
  line_unpriced: "We couldn't find a price for this item on your account, so a team member will review it.",
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

/**
 * Structured, buyer-safe detail attached to a line issue. Everything here is copied from
 * the resolution — the reply drafters interpolate these numbers rather than restating
 * anything a model produced.
 */
function lineIssueData(
  kind: ValidationIssueKind,
  line: ResolvedLine,
): Record<string, unknown> | undefined {
  if (kind === "price_mismatch") {
    const stated = line.line.statedUnitPrice;
    const calculated = line.calculatedUnitPrice;
    return {
      stated,
      calculated,
      // Below-contract is the case that wants a sales-priced quote, not a correction.
      direction: stated != null && calculated != null ? (stated < calculated ? "below" : "above") : undefined,
    };
  }
  if (kind === "line_sku_description_conflict") {
    return { description: line.line.description, productName: line.productName, reason: line.descriptionConflict };
  }
  if (kind === "line_parent_sku") {
    return {
      productName: line.productName,
      choices: line.variantChoices ?? [],
      choiceCount: line.variantChoiceCount ?? line.variantChoices?.length ?? 0,
    };
  }
  return undefined;
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
      issues.push(issue(kind, ref, lineIssueData(kind, line)));
    }
  }

  // Are there any lines we could actually submit? A blanket line_unresolved is only
  // added when nothing else already explains why (e.g. every line is a parent SKU).
  const submittable = submittableLines(input.resolvedLines);
  const explained = issues.some((i) => i.kind === "line_unresolved" || i.kind === "line_parent_sku");
  if (input.resolvedLines.length > 0 && submittable.length === 0 && !explained) {
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
