// Wire/domain types for the read-only Magento layer.

/** A price at or below this is a placeholder in the Petro Valve catalog ($0.01) — escalate. */
export const PRICE_ANOMALY_MAX = 0.01;

/**
 * Product attributes that may leave lib/magento. Magento returns every EAV attribute in
 * `custom_attributes` — including `cost`, which must NEVER reach a reply, log or UI — and its
 * `fields` filter cannot drop a single attribute, so this allow-list is the only gate.
 * Select-type codes (body_material, design, …) come back as option ids, not labels.
 */
export const SAFE_ATTRIBUTES = [
  "short_description",
  "description",
  "ecc_brand",
  "VFN",
  "mfr",
  "supplier_figure_no",
  "valve_type1",
  "valve_type2",
  "valve_size",
  "valve_pressure",
  "end_connection",
  "body_material",
  "body_type",
  "bonnet_type1",
  "bonnet_type2",
  "design",
  "trim",
  "is_ecc_discontinued",
  "is_ecc_non_stock",
  "url_key",
] as const;

export type SafeAttribute = (typeof SAFE_ATTRIBUTES)[number];

export interface MagentoProduct {
  sku: string;
  name: string;
  /** "simple" variants carry the price; "configurable" parents are priced 0 and not purchasable. */
  typeId: string;
  /** Magento status 1 = enabled, 2 = disabled. */
  enabled: boolean;
  /** 1 not visible individually, 2 catalog, 3 search, 4 catalog + search. */
  visibility: number;
  /** Base `price` (no special_price is set in this catalog; tier/catalog-rule prices not applied). */
  price: number;
  /** True for a purchasable item priced at or below PRICE_ANOMALY_MAX. */
  priceAnomaly: boolean;
  /** Present only when requested with `withAttributes`; allow-listed (never `cost`). */
  attributes?: Partial<Record<SafeAttribute, string>>;
}

export type SkuResolution =
  /** `exact` is false when a brand prefix had to be added to the buyer's SKU — a recommendation to confirm. */
  | { status: "matched"; input: string; product: MagentoProduct; exact: boolean }
  /** The SKU is a configurable parent: a size/variant must be chosen. */
  | { status: "parent"; input: string; product: MagentoProduct; children: MagentoProduct[]; childCount: number; exact: boolean }
  /** Several brands carry this model number and the buyer gave no prefix. */
  | { status: "ambiguous"; input: string; candidates: MagentoProduct[] }
  | { status: "unresolved"; input: string };
