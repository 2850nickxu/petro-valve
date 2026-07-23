import { bcFetchData } from "./bc-client";
import type { StoreContext } from "./store-context";

// Headless cart creation: POST /v3/carts with customer_id + channel_id + line_items.
// Attributing the cart to the buyer's customer_id (never guest) is what makes B2B
// Edition ingest the resulting order as a company order and applies the buyer's
// group/price-list pricing server-side — so we never send price overrides.

export interface CartLineInput {
  productId: number;
  variantId?: number;
  quantity: number;
}

export interface BcPhysicalItem {
  id: string;
  product_id: number;
  variant_id?: number;
  quantity: number;
  sale_price?: number;
  list_price?: number;
}

export interface BcCart {
  id: string;
  customer_id: number;
  channel_id: number;
  line_items: { physical_items: BcPhysicalItem[] };
}

export async function createCart(
  ctx: StoreContext,
  params: { customerId: number; channelId?: number; lineItems: CartLineInput[] },
): Promise<BcCart> {
  const body = {
    customer_id: params.customerId,
    channel_id: params.channelId ?? ctx.channelId,
    line_items: params.lineItems.map((li) => ({
      product_id: li.productId,
      quantity: li.quantity,
      ...(li.variantId ? { variant_id: li.variantId } : {}),
    })),
  };
  return await bcFetchData<BcCart>(ctx, `/v3/carts?include=line_items.physical_items`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
