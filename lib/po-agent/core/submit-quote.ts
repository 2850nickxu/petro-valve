import type { StoreContext } from "@/lib/bc/store-context";
import { createQuote, acceptQuote, computeExpiryDate, type QuoteItemInput } from "@/lib/bc/quotes";
import { submittableLines } from "./resolve";
import { SANDBOX_NOTE } from "./submit-order";
import type { Buyer, ResolvedLine } from "../types";

export interface SubmitQuoteParams {
  /** The company buyer. Omit (and pass `guest`) for a guest quote at list price. */
  buyer?: Buyer;
  guest?: { email: string; name?: string };
  channelId: number;
  resolvedLines: ResolvedLine[];
  poNumber?: string;
  expiryDays: number;
  notes?: string;
  /** Sandbox run: tag the quote notes so it's identifiable/cleanable. */
  sandbox?: boolean;
  now?: Date;
}

export type SubmitQuoteResult =
  | { ok: true; quoteId: number; quoteNumber?: string; quoteUrl?: string; checkoutUrl?: string }
  | { ok: false; reason: string };

export async function submitQuote(ctx: StoreContext, params: SubmitQuoteParams): Promise<SubmitQuoteResult> {
  const lines = submittableLines(params.resolvedLines);
  // Only the store-calculated price may go on a quote — never the PO's stated price. This
  // also guards staff force-quote, which skips the decision step that blocks unpriced lines.
  if (lines.some((l) => l.calculatedUnitPrice == null)) return { ok: false, reason: "line_unpriced" };
  const items: QuoteItemInput[] = lines.map((l) => ({
    productId: l.productId!,
    variantId: l.variantId,
    sku: l.matchedSku ?? l.line.sku ?? "",
    quantity: l.line.quantity ?? 1,
    unitPrice: l.calculatedUnitPrice!,
    productName: l.productName,
  }));
  if (!items.length) return { ok: false, reason: "no_items" };

  const buyer = params.buyer;
  const email = buyer?.email ?? params.guest?.email;
  if (!email) return { ok: false, reason: "no_contact" };
  const who = buyer?.companyName || email;

  const created = await createQuote(ctx, {
    companyId: buyer?.companyId,
    contactInfo: buyer
      ? { name: buyer.companyRoleName ?? buyer.email, email: buyer.email, companyName: buyer.companyName }
      : { name: params.guest?.name || email, email },
    items,
    channelId: params.channelId,
    referenceNumber: params.poNumber ?? null,
    quoteTitle: params.poNumber ? `PO ${params.poNumber} — ${who}` : `Quote — ${who}`,
    notes: `${params.notes ?? ""}${params.sandbox ? SANDBOX_NOTE : ""}`.trim() || undefined,
    expiredAt: computeExpiryDate(params.expiryDays, params.now),
  });

  // Generate a checkout link (open quote; status-preserving). Non-fatal if it fails —
  // the Buyer Portal quoteUrl is the durable artifact.
  const checkout = await acceptQuote(ctx, created.quoteId);

  return {
    ok: true,
    quoteId: created.quoteId,
    quoteNumber: created.quoteNumber,
    quoteUrl: created.quoteUrl,
    checkoutUrl: checkout?.checkoutUrl,
  };
}
