// Guest carts — the only thing this app writes to Magento. A cart is built in three calls:
// POST /V1/guest-carts → masked id, POST /V1/guest-carts/{id}/items per line, then
// GET /V1/guest-carts/{id}/totals. Never a customer cart (/V1/customers/{id}/carts and
// /V1/carts/mine touch a real buyer's active cart), and never an email on the cart: Amasty
// abandoned-cart mail and the HubSpot cart sync are keyed on it. We can't delete carts, so
// every line is checked against the catalog (read-only) BEFORE the first write.

import { getProductsBySkus } from "./catalog";
import { MASKED_CART_ID_RE, magentoGuestCartGet, magentoGuestCartPost } from "./client";
import type { MagentoContext } from "./magento-context";

export interface CartLine {
  sku: string;
  qty: number;
}

export interface GuestCartItem {
  itemId: number;
  sku: string;
  name: string;
  qty: number;
  /** Unit price Magento put on the cart line (Epicor may reprice vs. the catalog). */
  price: number;
}

export interface GuestCartTotals {
  subtotal: number;
  grandTotal: number;
  currency: string;
  items: Array<{ itemId: number; name: string; qty: number; price: number; rowTotal: number }>;
}

export interface GuestCart {
  maskedId: string;
  items: GuestCartItem[];
  totals: GuestCartTotals;
  /** Lines whose cart price differs from the catalog price we read beforehand. */
  priceMismatches: Array<{ sku: string; catalogPrice: number; cartPrice: number }>;
}

export type PreflightReason = "not_found" | "not_purchasable" | "disabled" | "price_anomaly" | "bad_quantity";

/** Thrown before any write when a line can't go into a cart. */
export class CartPreflightError extends Error {
  constructor(readonly problems: Array<{ sku: string; reason: PreflightReason }>) {
    super(`Guest cart not created — ${problems.map((p) => `${p.sku}: ${p.reason}`).join("; ")}`);
    this.name = "CartPreflightError";
  }
}

/** Thrown when a write fails after the cart exists; the (emailless) cart is left as-is. */
export class GuestCartBuildError extends Error {
  constructor(
    readonly maskedId: string,
    readonly added: GuestCartItem[],
    readonly failure: unknown,
  ) {
    super(`Guest cart ${maskedId} is incomplete (${added.length} item(s) added): ${String(failure)}`);
    this.name = "GuestCartBuildError";
  }
}

interface RawCartItem {
  item_id: number;
  sku: string;
  name?: string;
  qty: number;
  price?: number;
}

interface RawTotals {
  subtotal?: number;
  grand_total?: number;
  quote_currency_code?: string;
  base_currency_code?: string;
  items?: Array<{ item_id: number; name?: string; qty: number; price?: number; row_total?: number }>;
}

export async function createGuestCart(ctx: MagentoContext): Promise<string> {
  const maskedId = await magentoGuestCartPost<unknown>(ctx, "/guest-carts");
  if (typeof maskedId !== "string" || !MASKED_CART_ID_RE.test(maskedId)) {
    throw new Error("Magento returned an unexpected guest cart id.");
  }
  return maskedId;
}

export async function addGuestCartItem(ctx: MagentoContext, maskedId: string, line: CartLine): Promise<GuestCartItem> {
  // Only sku/qty/quote_id — no customer, email or address ever goes on a guest cart.
  const raw = await magentoGuestCartPost<RawCartItem>(ctx, `/guest-carts/${maskedId}/items`, {
    cartItem: { sku: line.sku, qty: line.qty, quote_id: maskedId },
  });
  return { itemId: raw.item_id, sku: raw.sku, name: raw.name ?? raw.sku, qty: raw.qty, price: Number(raw.price ?? 0) };
}

export async function getGuestCartTotals(ctx: MagentoContext, maskedId: string): Promise<GuestCartTotals> {
  const raw = await magentoGuestCartGet<RawTotals>(ctx, `/guest-carts/${maskedId}/totals`);
  return {
    subtotal: Number(raw.subtotal ?? 0),
    grandTotal: Number(raw.grand_total ?? 0),
    currency: raw.quote_currency_code ?? raw.base_currency_code ?? "USD",
    items: (raw.items ?? []).map((i) => ({
      itemId: i.item_id,
      name: i.name ?? "",
      qty: i.qty,
      price: Number(i.price ?? 0),
      rowTotal: Number(i.row_total ?? 0),
    })),
  };
}

/** Same SKU on several lines becomes one line with the summed quantity. */
function mergeLines(lines: CartLine[]): CartLine[] {
  const bySku = new Map<string, CartLine>();
  for (const l of lines) {
    const sku = l.sku.trim();
    const prev = bySku.get(sku.toUpperCase());
    bySku.set(sku.toUpperCase(), { sku: prev?.sku ?? sku, qty: (prev?.qty ?? 0) + l.qty });
  }
  return [...bySku.values()];
}

/**
 * Build a guest cart for already-resolved catalog SKUs. Preflight (reads only) rejects the
 * whole cart if any line is unknown, not a purchasable simple item, disabled, priced as a
 * placeholder, or has a non-positive/non-integer quantity — so nothing is written for it.
 */
export async function buildGuestCart(ctx: MagentoContext, lines: CartLine[]): Promise<GuestCart> {
  if (!ctx.guestCartWrites) {
    throw new Error("Magento guest-cart writes are disabled (set MAGENTO_GUEST_CART_WRITES=true).");
  }
  const merged = mergeLines(lines.filter((l) => l.sku.trim()));
  if (!merged.length) throw new CartPreflightError([]);

  const catalog = await getProductsBySkus(ctx, merged.map((l) => l.sku));
  const problems: Array<{ sku: string; reason: PreflightReason }> = [];
  for (const l of merged) {
    const p = catalog.get(l.sku.toUpperCase());
    const reason: PreflightReason | null = !Number.isInteger(l.qty) || l.qty <= 0
      ? "bad_quantity"
      : !p
        ? "not_found"
        : p.typeId !== "simple"
          ? "not_purchasable"
          : !p.enabled
            ? "disabled"
            : p.priceAnomaly
              ? "price_anomaly"
              : null;
    if (reason) problems.push({ sku: l.sku, reason });
  }
  if (problems.length) throw new CartPreflightError(problems);

  const maskedId = await createGuestCart(ctx);
  const items: GuestCartItem[] = [];
  try {
    for (const l of merged) items.push(await addGuestCartItem(ctx, maskedId, { sku: catalog.get(l.sku.toUpperCase())!.sku, qty: l.qty }));
    const totals = await getGuestCartTotals(ctx, maskedId);
    const priceMismatches = items
      .map((i) => ({ sku: i.sku, catalogPrice: catalog.get(i.sku.toUpperCase())?.price ?? NaN, cartPrice: i.price }))
      .filter((m) => Math.abs(m.catalogPrice - m.cartPrice) > 0.005);
    return { maskedId, items, totals, priceMismatches };
  } catch (err) {
    throw new GuestCartBuildError(maskedId, items, err);
  }
}
