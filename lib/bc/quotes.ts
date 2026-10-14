import { b2bFetch } from "./b2b-client";
import type { StoreContext } from "./store-context";

// Quote creation + checkout-link generation. The B2B Edition quote validator enforces a
// strict invariant (verified via docs MCP, .../rest/b2b/storefront/request-for-quote/post-rfq):
//   - each item: discount = 0, offeredPrice = basePrice
//   - subtotal = grandTotal = Σ(offeredPrice × quantity)
// Raw JS float sums drift, so we snap every price to integer cents and derive the totals
// from those same cents — this is what avoids the 422 "grand total amount not match".

const PRICE_PRECISION = 2;
const SCALE = 10 ** PRICE_PRECISION;

export function toCents(n: number): number {
  return Math.round(n * SCALE);
}
export function fromCents(cents: number): number {
  return cents / SCALE;
}

export interface QuoteItemInput {
  productId: number;
  variantId?: number;
  sku: string;
  quantity: number;
  /** Store-calculated unit price (authoritative). Snapped to cents internally. */
  unitPrice: number;
  productName?: string;
  options?: Array<{ optionId: number; optionValue: string | number }>;
}

export interface CreateQuoteParams {
  /** Omit for a guest quote: companyId is only required for a Company account
   * (docs.bigcommerce.com/developer/api-reference/rest/b2b/management/quotes/post-rfq). */
  companyId?: number;
  contactInfo: { name: string; email: string; companyName?: string; phoneNumber?: string };
  items: QuoteItemInput[];
  channelId?: number;
  /** PO number → quoteReference. */
  referenceNumber?: string | null;
  quoteTitle?: string;
  notes?: string;
  /** MM/DD/YYYY */
  expiredAt: string;
  currencyCode?: string;
}

export interface CreateQuoteResult {
  quoteId: number;
  quoteNumber?: string;
  quoteUrl?: string;
}

function defaultCurrency(currencyCode: string) {
  return {
    location: "left",
    token: "$",
    decimalToken: ".",
    decimalPlaces: PRICE_PRECISION,
    thousandsToken: ",",
    currencyCode,
  };
}

interface RawCreateQuote {
  id?: number | string;
  quoteId?: number | string;
  quoteNumber?: number | string;
  quoteUrl?: string;
}

export async function createQuote(
  ctx: StoreContext,
  params: CreateQuoteParams,
): Promise<CreateQuoteResult> {
  // Snap each line to integer cents; derive totals from the same cents.
  let subtotalCents = 0;
  const productList = params.items.map((it) => {
    const unitCents = toCents(it.unitPrice);
    subtotalCents += unitCents * it.quantity;
    const price = fromCents(unitCents);
    return {
      productId: it.productId,
      ...(it.variantId ? { variantId: it.variantId } : {}),
      sku: it.sku,
      basePrice: price,
      offeredPrice: price, // must equal basePrice
      discount: 0, // must be 0
      quantity: it.quantity,
      ...(it.productName ? { productName: it.productName } : {}),
      ...(it.options ? { options: it.options } : {}),
    };
  });

  const total = fromCents(subtotalCents);
  const currencyCode = params.currencyCode ?? "USD";

  const body = {
    grandTotal: total,
    subtotal: total,
    discount: 0,
    // Server-to-server creation: the agent is a backend user. Do NOT send a top-level
    // userEmail — the management /rfq endpoint validates it against B2B Control Panel
    // *system* users (buyers 422). The buyer stays in contactInfo. (Verified [L2].)
    isBackendUser: "1",
    expiredAt: params.expiredAt,
    channelId: params.channelId ?? ctx.channelId,
    ...(params.companyId != null ? { companyId: params.companyId } : {}),
    storeHash: ctx.storeHash,
    ...(params.quoteTitle ? { quoteTitle: params.quoteTitle } : {}),
    ...(params.referenceNumber ? { quoteReference: params.referenceNumber } : {}),
    ...(params.notes ? { quoteNotes: params.notes } : {}),
    contactInfo: params.contactInfo,
    currency: defaultCurrency(currencyCode),
    productList,
  };

  const raw = await b2bFetch<RawCreateQuote>(ctx, `/rfq`, {
    method: "POST",
    body: JSON.stringify(body),
  });

  return {
    quoteId: Number(raw.quoteId ?? raw.id ?? 0),
    quoteNumber: raw.quoteNumber != null ? String(raw.quoteNumber) : undefined,
    quoteUrl: raw.quoteUrl,
  };
}

export interface QuoteCheckout {
  checkoutUrl: string;
  cartId: string;
  cartUrl: string;
}

/**
 * Generate a cart + checkout URL for an OPEN quote (POST {io}/rfq/{id}/checkout). Does
 * NOT change the quote status — the quote only moves to Ordered on purchase. 404 if the
 * quote is not Open. Treat quoteUrl (Buyer Portal) as the durable artifact in emails.
 */
export async function acceptQuote(
  ctx: StoreContext,
  quoteId: number | string,
): Promise<QuoteCheckout | null> {
  try {
    const raw = await b2bFetch<QuoteCheckout>(ctx, `/rfq/${quoteId}/checkout`, {
      method: "POST",
      body: JSON.stringify({ storeHash: ctx.storeHash }),
    });
    if (!raw?.checkoutUrl) return null;
    return raw;
  } catch {
    return null;
  }
}

/** Compute an MM/DD/YYYY expiry N days from a base date (default now; injectable for tests). */
export function computeExpiryDate(days: number, from: Date = new Date()): string {
  const d = new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}
