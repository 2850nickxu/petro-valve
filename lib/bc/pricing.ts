import { bcFetchData } from "./bc-client";
import type { StoreContext } from "./store-context";
import type { BcPricingItem, BcPriceObject } from "./types";

// POST /v3/pricing/products — the authoritative "what the site would charge" for a
// customer group / customer / channel, including price-list and customer-group rules.
// (Verified via docs MCP: .../rest/admin/management/pricing/products/get-prices.)

export interface PriceRequestItem {
  productId: number;
  variantId?: number;
}

export interface PricingParams {
  items: PriceRequestItem[];
  customerId?: number;
  customerGroupId?: number;
  channelId?: number;
  currencyCode?: string;
}

export interface PricedItem {
  productId: number;
  variantId?: number;
  /** Tax-exclusive unit price (net) — the contract/list price to compare & charge at. */
  unitPrice: number;
  calculated?: BcPriceObject;
}

export function priceKey(productId: number, variantId?: number): string {
  return variantId ? `${productId}:${variantId}` : `${productId}`;
}

function unitFrom(item: BcPricingItem): number {
  const cp = item.calculated_price;
  if (cp) return cp.tax_exclusive ?? cp.as_entered ?? 0;
  return item.price?.tax_exclusive ?? item.price?.as_entered ?? 0;
}

export async function getProductPrices(
  ctx: StoreContext,
  params: PricingParams,
): Promise<Map<string, PricedItem>> {
  const map = new Map<string, PricedItem>();
  if (!params.items.length) return map;

  const body = {
    channel_id: params.channelId ?? ctx.channelId,
    // BC requires a non-empty currency_code; extraction emits "" for an unstated
    // currency, so `||` (not `??`) is deliberate here to fall back on empty strings.
    currency_code: params.currencyCode?.trim() || "USD",
    customer_group_id: params.customerGroupId ?? 0,
    customer_id: params.customerId ?? 0,
    items: params.items.map((i) => ({
      product_id: i.productId,
      ...(i.variantId ? { variant_id: i.variantId } : {}),
    })),
  };

  const data = await bcFetchData<BcPricingItem[]>(ctx, `/v3/pricing/products`, {
    method: "POST",
    body: JSON.stringify(body),
  });

  for (const item of data) {
    map.set(priceKey(item.product_id, item.variant_id), {
      productId: item.product_id,
      variantId: item.variant_id,
      unitPrice: unitFrom(item),
      calculated: item.calculated_price,
    });
  }
  return map;
}
