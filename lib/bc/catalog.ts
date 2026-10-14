import { bcFetchData } from "./bc-client";
import type { StoreContext } from "./store-context";
import type { ProductDetail } from "./types";

// Product detail for purchasability checks: visibility, availability, inventory,
// and order-quantity bounds. GET /v3/catalog/products?id:in=…

interface RawProduct {
  id: number;
  name?: string;
  sku?: string;
  price?: number;
  is_visible?: boolean;
  availability?: string;
  inventory_level?: number;
  inventory_tracking?: string;
  order_quantity_minimum?: number;
  order_quantity_maximum?: number;
}

function mapProduct(raw: RawProduct): ProductDetail {
  return {
    id: raw.id,
    name: raw.name ?? "",
    sku: raw.sku ?? "",
    price: raw.price ?? 0,
    is_visible: raw.is_visible ?? true,
    availability: raw.availability ?? "available",
    inventory_level: raw.inventory_level ?? 0,
    inventory_tracking: raw.inventory_tracking ?? "none",
    order_quantity_minimum: raw.order_quantity_minimum ?? 0,
    order_quantity_maximum: raw.order_quantity_maximum ?? 0,
  };
}

export async function getProductsByIds(
  ctx: StoreContext,
  productIds: number[],
): Promise<Map<number, ProductDetail>> {
  const map = new Map<number, ProductDetail>();
  const ids = [...new Set(productIds)];
  if (!ids.length) return map;
  // Throws on failure: an empty map would pass every line as available, unchecked.
  const products = await bcFetchData<RawProduct[]>(
    ctx,
    `/v3/catalog/products?id:in=${ids.join(",")}&limit=250`,
  );
  for (const p of products) map.set(p.id, mapProduct(p));
  return map;
}
