import type { ResolvedLine, ValidationIssue, VariantChoice } from "../types";
import { submittableLines } from "../core/resolve";

// Deterministic email-body builders. Every number is interpolated from validated
// structured data — never invented. (An optional AI tone-polish pass can wrap these; the
// numbers still come from here.)

export function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

export function lineSummary(resolved: ResolvedLine[]): string {
  return submittableLines(resolved)
    .map((l) => {
      const qty = l.line.quantity ?? 1;
      const unit = l.calculatedUnitPrice ?? l.line.statedUnitPrice ?? 0;
      const sku = l.matchedSku ?? l.line.sku ?? "item";
      return `• ${qty} × ${sku} @ ${money(unit)} = ${money(qty * unit)}`;
    })
    .join("\n");
}

export function draftRejection(): string {
  return "Hello,\n\nWe received your message but couldn't match your email address to a company account, so we're unable to process this purchase order automatically. Please contact your sales representative.\n\nThank you.";
}

export function draftEscalationNotice(): string {
  return "Hello,\n\nThank you for your purchase order. A member of our team will review it and follow up with you shortly.\n\nThank you.";
}

export function draftTriage(): string {
  return "Hello,\n\nThis mailbox processes purchase orders. If you'd like to place an order, please reply with your PO (items, quantities, and your PO number). For anything else, please contact your sales representative.\n\nThank you.";
}

/** The child-variant menu under a parent-SKU bullet. Prices come from the pricing pass. */
function variantMenu(issue: ValidationIssue): string {
  const data = issue.data as { choices?: VariantChoice[]; choiceCount?: number } | undefined;
  const choices = data?.choices ?? [];
  if (!choices.length) return "";
  const shown = choices.slice(0, MAX_CHOICES_IN_EMAIL);
  const lines = shown.map((c) => {
    const label = c.optionLabel ? ` — ${c.optionLabel}` : "";
    const price = c.unitPrice != null ? ` — ${money(c.unitPrice)} ea` : "";
    return `    · ${c.sku}${label}${price}`;
  });
  const total = data?.choiceCount ?? choices.length;
  if (total > shown.length) lines.push(`    · …and ${total - shown.length} more — ask us for the full list.`);
  return `\n  Available versions:\n${lines.join("\n")}\n  Reply with the part number you need (and the quantity for each, if you want more than one).`;
}

/** The price-difference paragraph: state both numbers, then offer the two real choices. */
function priceOffer(issues: ValidationIssue[]): string {
  const mismatches = issues.filter((i) => i.kind === "price_mismatch");
  if (!mismatches.length) return "";
  const detail = mismatches
    .map((i) => {
      const d = i.data as { stated?: number | null; calculated?: number | null } | undefined;
      const ref = i.lineRef ? `${i.lineRef}: ` : "";
      if (d?.stated == null || d?.calculated == null) return `${ref}the PO price differs from your contract price`;
      return `${ref}your PO says ${money(d.stated)} ea, your contract price is ${money(d.calculated)} ea`;
    })
    .join("\n• ");
  return (
    `\n\nOn pricing:\n\n• ${detail}\n\n` +
    `You have two options: reply CONFIRM and we'll place the order at the contract price, ` +
    `or reply QUOTE and we'll send this to your sales team to review for specialty pricing ` +
    `before anything is placed.`
  );
}

const MAX_CHOICES_IN_EMAIL = 8;

export function draftClarification(issues: ValidationIssue[]): string {
  const blocking = issues.filter((i) => i.blocking);
  const bullets = blocking
    .filter((i) => i.kind !== "price_mismatch")
    .map((i) => `• ${i.message}${i.lineRef ? ` (${i.lineRef})` : ""}${i.kind === "line_parent_sku" ? variantMenu(i) : ""}`)
    .join("\n");
  const body = bullets
    ? `Before we can process your purchase order, we need a bit more information:\n\n${bullets}`
    : `Thanks for your purchase order — one thing to sort out before we place it.`;
  return `Hello,\n\n${body}${priceOffer(blocking)}\n\nPlease reply with these details and we'll proceed right away.\n\nThank you.`;
}

export function draftFirstOrderConfirm(resolved: ResolvedLine[], grandTotalText: string): string {
  return `Hello,\n\nThanks for your purchase order. Since this is the first order from your address, please confirm before we place it:\n\n${lineSummary(resolved)}\n\nEstimated total (before shipping/tax): ${grandTotalText}\n\nReply CONFIRM to place this order on account.\n\nThank you.`;
}

export interface OrderConfirmData {
  orderId: number;
  poNumber?: string;
  resolved: ResolvedLine[];
  totals: { subtotal: number; shippingTotal: number; taxTotal: number; grandTotal: number };
}

export function draftOrderConfirmation(d: OrderConfirmData): string {
  return `Hello,\n\nYour order has been placed on account.\n\nOrder #: ${d.orderId}\nPO #: ${d.poNumber ?? "(none provided)"}\n\n${lineSummary(d.resolved)}\n\nSubtotal: ${money(d.totals.subtotal)}\nShipping: ${money(d.totals.shippingTotal)}\nTax: ${money(d.totals.taxTotal)}\nTotal: ${money(d.totals.grandTotal)}\n\nThank you.`;
}

export interface QuoteConfirmData {
  quoteNumber: string;
  resolved: ResolvedLine[];
  checkoutUrl?: string;
  quoteUrl?: string;
}

export function draftQuoteConfirmation(d: QuoteConfirmData): string {
  const pay = d.checkoutUrl ? `\nPay by card here: ${d.checkoutUrl}` : "";
  const portal = d.quoteUrl ? `\nView in the Buyer Portal: ${d.quoteUrl}` : "";
  return `Hello,\n\nWe've prepared a quote for your purchase order.\n\nQuote #: ${d.quoteNumber}\n\n${lineSummary(d.resolved)}${pay}${portal}\n\nThank you.`;
}

export function draftNudge(issues: ValidationIssue[]): string {
  const bullets = issues.filter((i) => i.blocking).map((i) => `• ${i.message}`).join("\n");
  return `Hello,\n\nJust following up on your purchase order — we're still waiting on a few details:\n\n${bullets}\n\nReply any time and we'll pick right back up.\n\nThank you.`;
}

export function draftExpiry(): string {
  return "Hello,\n\nWe've paused this purchase order since we didn't hear back. Reply to this email any time to reopen it, or contact your sales representative.\n\nThank you.";
}
