import type { ResolvedLine, ValidationIssue } from "../types";
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

export function draftClarification(issues: ValidationIssue[]): string {
  const bullets = issues
    .filter((i) => i.blocking)
    .map((i) => `• ${i.message}${i.lineRef ? ` (${i.lineRef})` : ""}`)
    .join("\n");
  return `Hello,\n\nBefore we can process your purchase order, we need a bit more information:\n\n${bullets}\n\nPlease reply with these details and we'll proceed right away.\n\nThank you.`;
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
