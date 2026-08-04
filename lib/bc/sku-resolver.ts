import { bcFetchData } from "./bc-client";
import type { StoreContext } from "./store-context";
import { MAX_VARIANT_CHOICES, type SkuResolution, type VariantChoice } from "./types";

// Resolve SKUs → { productId, variantId }: variant SKUs first, then remaining
// product-level SKUs. Unresolved SKUs are silently omitted from the map.
//
// A product-level SKU only maps to a variant when the product is a *simple* product —
// i.e. its single variant is the auto-created base variant (empty `option_values`). When
// the product carries real child variants the SKU is a PARENT SKU: BC has no way to know
// which child is meant and rejects the cart line with 422 "This product has options;
// variant ID is required". Those come back flagged `isParentSku` with the child choices
// attached so the agent can ask the buyer instead of silently picking the first one.
// (docs: /rest/admin/catalog/product-variants — base vs child variants, `option_values`.)

interface RawVariant {
  id: number;
  product_id: number;
  sku: string;
}
interface RawOptionValue {
  option_display_name?: string;
  label?: string;
}
interface RawNestedVariant {
  id: number;
  sku: string;
  product_id: number;
  option_values?: RawOptionValue[];
}
interface RawProduct {
  id: number;
  sku: string;
  variants?: RawNestedVariant[];
}

/** "Color: Red · Length: 4in" from a variant's option_values. */
function optionLabel(v: RawNestedVariant): string | undefined {
  const parts = (v.option_values ?? [])
    .map((o) => (o.option_display_name && o.label ? `${o.option_display_name}: ${o.label}` : o.label))
    .filter((s): s is string => Boolean(s));
  return parts.length ? parts.join(" · ") : undefined;
}

function toChoice(v: RawNestedVariant): VariantChoice {
  return { variantId: v.id, sku: v.sku, ...(optionLabel(v) ? { optionLabel: optionLabel(v) } : {}) };
}

/**
 * Does this product have real child variants? A base variant is always singular and has
 * no option values, so either signal alone is enough — checking both keeps detection
 * correct even if `option_values` is absent from the payload.
 */
function childVariantsOf(p: RawProduct): RawNestedVariant[] {
  const variants = p.variants ?? [];
  const withOptions = variants.filter((v) => (v.option_values?.length ?? 0) > 0);
  if (withOptions.length) return withOptions;
  return variants.length > 1 ? variants : [];
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
      if (p.sku && remaining.includes(p.sku) && !result.has(p.sku)) {
        const children = childVariantsOf(p);
        if (children.length) {
          // Parent SKU — not orderable as-is; hand back the choices to clarify with.
          result.set(p.sku, {
            productId: p.id,
            isParentSku: true,
            children: children.slice(0, MAX_VARIANT_CHOICES).map(toChoice),
            childCount: children.length,
          });
        } else {
          // Simple product: the product-level SKU IS the base variant.
          const first = p.variants?.[0];
          if (first) result.set(p.sku, { productId: p.id, variantId: first.id });
        }
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
