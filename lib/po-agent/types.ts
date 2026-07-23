// Core domain types for the PO agent. The AI extraction schema (Phase 3) is a zod
// schema whose inferred type is assignable to ExtractedPo here, so the pipeline stays
// decoupled from the AI layer.

export type Channel = "google" | "microsoft" | "simulator";

export type PaymentIntent = "on_account" | "credit_card" | "unspecified";

export type Confidence = "high" | "medium" | "low";

export interface Address {
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  country?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface PoLineItem {
  /** Provenance: the raw text the model read this line from (drives clarifications). */
  rawText: string;
  sku: string | null;
  description: string | null;
  quantity: number | null;
  statedUnitPrice: number | null;
  statedTotal: number | null;
}

export interface ExtractedPo {
  poNumber: string | null;
  buyerNote: string | null;
  paymentIntent: PaymentIntent;
  requestedShipDate: string | null;
  shipTo: Address | null;
  billTo: Address | null;
  lines: PoLineItem[];
  currency: string | null;
  confidence: Confidence;
}

export type ValidationIssueKind =
  | "unknown_sender"
  | "company_not_approved"
  | "channel_ambiguous"
  | "channel_access_denied"
  | "line_unresolved"
  | "line_blocked_by_assortment"
  | "line_qty_bounds"
  | "line_inventory_short"
  | "price_mismatch"
  | "missing_quantity"
  | "missing_ship_to"
  | "payment_method_unavailable"
  | "credit_exceeded"
  | "credit_hold"
  | "quote_feature_disabled"
  | "po_number_missing"
  | "stale_thread"
  | "multi_currency"
  | "daily_cap"
  | "internal_error";

export interface ValidationIssue {
  kind: ValidationIssueKind;
  /** Human-readable, safe to interpolate into buyer email (no secrets). */
  message: string;
  /** rawText or sku for line-level provenance. */
  lineRef?: string;
  /** Must be resolved (clarify/escalate) before we can submit. */
  blocking: boolean;
  data?: Record<string, unknown>;
}

export interface ResolvedLine {
  line: PoLineItem;
  productId?: number;
  variantId?: number;
  matchedSku?: string;
  /** Store-authoritative unit price from /v3/pricing/products (integer-safe). */
  calculatedUnitPrice?: number;
  productName?: string;
  available?: boolean;
  inventoryLevel?: number | null;
  inventoryTracked?: boolean;
  minQty?: number;
  maxQty?: number;
  blockedByAssortment?: boolean;
  issues: ValidationIssueKind[];
  note?: string;
}

export interface Buyer {
  email: string;
  b2bUserId: number;
  customerId: number;
  companyId: number;
  role: number;
  companyRoleName?: string;
  companyName: string;
  customerGroupId?: number;
  /** B2B channels the user may transact on (MSF); empty/undefined ⇒ single-channel. */
  channelList?: number[];
}

export type DecisionKind = "order" | "quote" | "escalate" | "clarify" | "reject";

export interface Decision {
  kind: DecisionKind;
  reasons: string[];
}

export type PoSessionState =
  | "new"
  | "identifying"
  | "clarifying"
  | "awaiting_confirmation"
  | "validating"
  | "submitting"
  | "completed_order"
  | "completed_quote"
  | "escalated"
  | "rejected"
  | "expired";

export interface PoResult {
  orderId?: number;
  quoteId?: number;
  quoteNumber?: string;
  checkoutUrl?: string;
  quoteUrl?: string;
  confirmationMessageId?: string;
}

export interface Escalation {
  reasons: string[];
  at: string;
  notified: Array<"email" | "slack" | "queue">;
}

export interface AuditEntry {
  at: string;
  event: string;
  detail?: unknown;
}

export interface PoSession {
  /** `${channel}:${threadId}` */
  id: string;
  channel: Channel;
  threadId: string;
  /** Resolved BigCommerce channel id for this session (MSF). */
  channelId?: number;
  state: PoSessionState;
  /** One nudge per session (§7.7). */
  remindedAt?: string;
  clarificationRounds: number;
  buyer?: Buyer;
  extracted?: ExtractedPo;
  resolution?: ResolvedLine[];
  validation?: ValidationIssue[];
  decision?: Decision;
  result?: PoResult;
  escalation?: Escalation;
  audit: AuditEntry[];
  messageIds: string[];
  createdAt: string;
  updatedAt: string;
}
