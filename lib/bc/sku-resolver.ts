import { bcFetchData } from "./bc-client";
import type { StoreContext } from "./store-context";
import type { SkuResolution } from "./types";

// Resolve SKUs → { productId, variantId } (ported verbatim in behavior from the
// accelerator): variant SKUs first, then remaining product-level SKUs mapped to the
// product's default (first) variant. Unresolved SKUs are silently omitted from the map.

interface RawVariant {
  id: number;
  product_id: number;
  sku: string;
}
interface RawProduct {
  id: number;
  sku: string;
  variants?: Array<{ id: number; sku: string; product_id: number }>;
}

const MAX_PER_REQUEST = 250;

export async function resolveSkusToIds(
  ctx: StoreContext,
  skus: string[],
): Promise<Map<string, SkuResolution>> {
  const result = new Map<string, SkuResolution>();
  const clean = [...new Set(skus.map((s) => s.trim()).filter(Boolean))].slice(0, MAX_PER_REQUEST);
  if (!clean.length) return result;

  // 1) Variant-level SKUs.
  try {
    const variants = await bcFetchData<RawVariant[]>(
      ctx,
      `/v3/catalog/variants?sku:in=${encodeURIComponent(clean.join(","))}&limit=${MAX_PER_REQUEST}`,
    );
    for (const v of variants) {
      if (v.sku) result.set(v.sku, { productId: v.product_id, variantId: v.id });
    }
  } catch {
    /* fall through to product lookup */
  }

  // 2) Remaining SKUs may be product-level.
  const remaining = clean.filter((s) => !result.has(s));
  if (!remaining.length) return result;

  try {
    const products = await bcFetchData<RawProduct[]>(
      ctx,
      `/v3/catalog/products?sku:in=${encodeURIComponent(remaining.join(","))}&include=variants&limit=${MAX_PER_REQUEST}`,
    );
    for (const p of products) {
      // Product-level SKU → default (first) variant.
      if (p.sku && remaining.includes(p.sku) && !result.has(p.sku)) {
        const first = p.variants?.[0];
        if (first) result.set(p.sku, { productId: p.id, variantId: first.id });
      }
      // Nested variant SKUs the variant endpoint may have missed.
      for (const v of p.variants ?? []) {
        if (v.sku && remaining.includes(v.sku) && !result.has(v.sku)) {
          result.set(v.sku, { productId: p.id, variantId: v.id });
        }
      }
    }
  } catch {
    /* leave unresolved */
  }

  return result;
}
