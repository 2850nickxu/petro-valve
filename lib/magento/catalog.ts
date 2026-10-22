// Read-only catalog lookups against Magento's /V1/products search. Every request names the
// fields it wants; attributes are opt-in (`withAttributes`) and pass through the SAFE_ATTRIBUTES
// allow-list, so `cost` never leaves this module.

import { magentoGet, searchQuery } from "./client";
import type { MagentoContext } from "./magento-context";
import { PRICE_ANOMALY_MAX, SAFE_ATTRIBUTES, type MagentoProduct, type SafeAttribute } from "./types";

const BASE_FIELDS = "sku,name,price,type_id,status,visibility";
const SAFE_SET = new Set<string>(SAFE_ATTRIBUTES);
/** SKUs per `in` search — keeps the URL well under server limits. */
const MAX_SKUS_PER_REQUEST = 50;

export interface LookupOptions {
  /** Also return the allow-listed descriptive attributes (costs one bigger response). */
  withAttributes?: boolean;
}

interface RawProduct {
  sku: string;
  name?: string;
  price?: number;
  type_id?: string;
  status?: number;
  visibility?: number;
  custom_attributes?: Array<{ attribute_code: string; value: unknown }>;
}

interface RawSearch {
  items?: RawProduct[] | null;
  total_count?: number;
}

const productFields = (opts: LookupOptions) => (opts.withAttributes ? `${BASE_FIELDS},custom_attributes` : BASE_FIELDS);

/** Map a raw Magento product to the safe domain shape. Drops every non-allow-listed attribute. */
export function toProduct(raw: RawProduct, opts: LookupOptions = {}): MagentoProduct {
  const typeId = raw.type_id ?? "simple";
  const price = Number(raw.price ?? 0);
  const product: MagentoProduct = {
    sku: raw.sku,
    name: raw.name ?? raw.sku,
    typeId,
    enabled: raw.status === 1,
    visibility: raw.visibility ?? 0,
    price,
    priceAnomaly: typeId !== "configurable" && price <= PRICE_ANOMALY_MAX,
  };
  if (opts.withAttributes) {
    const attributes: Partial<Record<SafeAttribute, string>> = {};
    for (const a of raw.custom_attributes ?? []) {
      if (SAFE_SET.has(a.attribute_code) && a.value != null) {
        attributes[a.attribute_code as SafeAttribute] = Array.isArray(a.value) ? a.value.join(",") : String(a.value);
      }
    }
    product.attributes = attributes;
  }
  return product;
}

/**
 * Exact lookup of many SKUs (`sku in (...)`), batched. Returns found products keyed by
 * upper-cased SKU; missing SKUs are simply absent.
 */
export async function getProductsBySkus(
  ctx: MagentoContext,
  skus: string[],
  opts: LookupOptions = {},
): Promise<Map<string, MagentoProduct>> {
  const out = new Map<string, MagentoProduct>();
  const clean = [...new Set(skus.map((s) => s.trim()).filter(Boolean))];
  for (let i = 0; i < clean.length; i += MAX_SKUS_PER_REQUEST) {
    const batch = clean.slice(i, i + MAX_SKUS_PER_REQUEST);
    const res = await magentoGet<RawSearch>(
      ctx,
      `/products?${searchQuery([["sku", batch.join(","), "in"]], {
        pageSize: batch.length,
        fields: `items[${productFields(opts)}],total_count`,
      })}`,
    );
    for (const raw of res.items ?? []) out.set(raw.sku.toUpperCase(), toProduct(raw, opts));
  }
  return out;
}

export async function getProductBySku(
  ctx: MagentoContext,
  sku: string,
  opts: LookupOptions = {},
): Promise<MagentoProduct | null> {
  return (await getProductsBySkus(ctx, [sku], opts)).get(sku.trim().toUpperCase()) ?? null;
}

/**
 * Partial-SKU search (`sku like %fragment%`) for buyers who give part of a number. This is a
 * recommendation source, not a match: callers must present results as suggestions to confirm.
 */
export async function searchProductsBySkuLike(
  ctx: MagentoContext,
  fragment: string,
  opts: LookupOptions & { limit?: number; typeId?: "simple" | "configurable" } = {},
): Promise<{ items: MagentoProduct[]; total: number }> {
  const term = fragment.replace(/[%_]/g, "").trim();
  if (!term) return { items: [], total: 0 };
  const filters: Array<[string, string, "like" | "eq"]> = [["sku", `%${term}%`, "like"]];
  if (opts.typeId) filters.push(["type_id", opts.typeId, "eq"]);
  const res = await magentoGet<RawSearch>(
    ctx,
    `/products?${searchQuery(filters, {
      pageSize: opts.limit ?? 20,
      currentPage: 1,
      fields: `items[${productFields(opts)}],total_count`,
    })}`,
  );
  return { items: (res.items ?? []).map((raw) => toProduct(raw, opts)), total: res.total_count ?? 0 };
}

/** The purchasable variants (sizes) of a configurable parent. */
export async function getConfigurableChildren(
  ctx: MagentoContext,
  parentSku: string,
  opts: LookupOptions = {},
): Promise<MagentoProduct[]> {
  const raw = await magentoGet<RawProduct[]>(
    ctx,
    `/configurable-products/${encodeURIComponent(parentSku)}/children?fields=${encodeURIComponent(productFields(opts))}`,
  );
  return (raw ?? []).map((p) => toProduct(p, opts));
}
