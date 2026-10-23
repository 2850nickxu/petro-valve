// The staff Catalog page's view of a SKU lookup: one flat row per requested line, safe to send
// to the browser (allow-listed fields only — never cost).

import type { SkuResolution } from "./types";

export interface LookupRow {
  input: string;
  qty: number | null;
  status: SkuResolution["status"];
  /** False when a brand prefix was added to the buyer's SKU (a recommendation to confirm). */
  exact?: boolean;
  sku?: string;
  name?: string;
  price?: number;
  priceAnomaly?: boolean;
  enabled?: boolean;
  /** Sizes of a configurable parent. */
  children?: Array<{ sku: string; price: number; priceAnomaly: boolean }>;
  childCount?: number;
  /** Brands that carry an ambiguous number. */
  candidates?: Array<{ sku: string; name: string; price: number; priceAnomaly: boolean }>;
  /**
   * What the agent would put in a cart: an exact match (not a recommendation) to an enabled
   * simple product with a real price and a stated quantity.
   */
  cartable: boolean;
}

/** "VO 12111-1, 2" / "VO 12111-1 x 2" / "VO 12111-1<TAB>2" / "VO 12111-1" → SKU text + quantity. */
export function parseLookupLine(raw: string): { input: string; qty: number | null } | null {
  const line = raw.trim();
  if (!line) return null;
  const m = line.match(/^(.*?)(?:\s*[,\t;]\s*|\s+[x×]\s*|\s+qty:?\s*)(\d+)\s*$/i);
  if (m && m[1].trim()) return { input: m[1].trim(), qty: Number(m[2]) };
  return { input: line, qty: null };
}

const nameOf = (p: { name: string; attributes?: { short_description?: string } }) => p.attributes?.short_description?.trim() || p.name;

export function lookupRow(input: string, qty: number | null, res: SkuResolution | undefined): LookupRow {
  if (!res || res.status === "unresolved") return { input, qty, status: "unresolved", cartable: false };
  if (res.status === "ambiguous") {
    return {
      input,
      qty,
      status: "ambiguous",
      candidates: res.candidates.map((c) => ({ sku: c.sku, name: nameOf(c), price: c.price, priceAnomaly: c.priceAnomaly })),
      cartable: false,
    };
  }
  const p = res.product;
  const base = { input, qty, exact: res.exact, sku: p.sku, name: nameOf(p), price: p.price, priceAnomaly: p.priceAnomaly, enabled: p.enabled };
  if (res.status === "parent") {
    return {
      ...base,
      status: "parent",
      children: res.children.map((c) => ({ sku: c.sku, price: c.price, priceAnomaly: c.priceAnomaly })),
      childCount: res.childCount,
      cartable: false,
    };
  }
  return { ...base, status: "matched", cartable: res.exact && qty != null && p.enabled && p.typeId === "simple" && !p.priceAnomaly };
}
