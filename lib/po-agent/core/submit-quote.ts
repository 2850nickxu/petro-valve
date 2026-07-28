import type { StoreContext } from "@/lib/bc/store-context";
import { createQuote, acceptQuote, computeExpiryDate, type QuoteItemInput } from "@/lib/bc/quotes";
import { submittableLines } from "./resolve";
import { SANDBOX_NOTE } from "./submit-order";
import type { Buyer, ResolvedLine } from "../types";

export interface SubmitQuoteParams {
  buyer: Buyer;
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
  const items: QuoteItemInput[] = submittableLines(params.resolvedLines).map((l) => ({
    productId: l.productId!,
    variantId: l.variantId,
    sku: l.matchedSku ?? l.line.sku ?? "",
    quantity: l.line.quantity ?? 1,
    // Store-calculated price is authoritative; fall back to stated only if unpriced.
    unitPrice: l.calculatedUnitPrice ?? l.line.statedUnitPrice ?? 0,
    productName: l.productName,
  }));
  if (!items.length) return { ok: false, reason: "no_items" };

  const created = await createQuote(ctx, {
    companyId: params.buyer.companyId,
    contactInfo: {
      name: params.buyer.companyRoleName ?? params.buyer.email,
      email: params.buyer.email,
      companyName: params.buyer.companyName,
    },
    items,
    channelId: params.channelId,
    referenceNumber: params.poNumber ?? null,
    quoteTitle: params.poNumber
      ? `PO ${params.poNumber} — ${params.buyer.companyName}`
      : `Quote — ${params.buyer.companyName}`,
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
