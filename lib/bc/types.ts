// Wire/domain types for the session-less BigCommerce/B2B layer.

// ── B2B Edition ──────────────────────────────────────────────────────────────

export interface B2BUser {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber?: string;
  /** Coarse role: 0 Admin, 1 Senior Buyer, 2 Junior Buyer. */
  role: number;
  customerId: number;
  companyId: number;
  /** Custom/company role id — overrides `role` when present. */
  companyRoleId?: number;
  companyRoleName?: string;
  /** Channels the user may transact on (MSF). Empty ⇒ single-channel store. */
  channelList: number[];
}

/** companyStatus: 0 pending, 1 approved, 2 rejected, 3 inactive. */
export interface B2BCompany {
  companyId: number;
  companyName: string;
  companyEmail?: string;
  companyStatus: number;
  bcGroupId?: number;
  bcGroupName?: string;
  priceListAssign?: Array<{ priceListId: number; channelId?: number }>;
  extraFields?: Array<{ fieldName: string; fieldValue: string }>;
  addressLine1?: string;
  city?: string;
  state?: string;
  country?: string;
  zipCode?: string;
}

export interface B2BCreditConfig {
  creditEnabled: boolean;
  creditCurrency?: string;
  /** Configured limit / per-order PO cap. */
  availableCredit: number;
  creditLimit: number;
  limitPurchases: boolean;
  creditHold: boolean;
}

export interface B2BPaymentTerms {
  isEnabled: boolean;
  paymentTermsDays: number;
}

export interface CompanyPaymentMethod {
  paymentId: number;
  code: string;
  paymentTitle: string;
  isEnabled: boolean;
}

export interface B2BCompanyAddress {
  addressId: number;
  label?: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  phoneNumber?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  stateName?: string;
  stateCode?: string;
  countryName?: string;
  countryCode?: string;
  zipCode?: string;
  isDefaultBilling: boolean;
  isDefaultShipping: boolean;
}

// ── Core catalog / pricing ───────────────────────────────────────────────────

export interface SkuResolution {
  productId: number;
  variantId: number;
}

/** A single price object from POST /v3/pricing/products (a facet of an item). */
export interface BcPriceObject {
  as_entered: number;
  entered_inclusive: boolean;
  tax_exclusive: number;
  tax_inclusive: number;
}

export interface BcPricingItem {
  product_id: number;
  variant_id?: number;
  price?: BcPriceObject;
  calculated_price?: BcPriceObject;
  sale_price?: BcPriceObject;
  retail_price?: BcPriceObject;
}

export interface ProductDetail {
  id: number;
  name: string;
  sku: string;
  price: number;
  is_visible: boolean;
  availability: string; // "available" | "disabled" | "preorder"
  inventory_level: number;
  inventory_tracking: string; // "none" | "product" | "variant"
  order_quantity_minimum: number;
  order_quantity_maximum: number;
}
