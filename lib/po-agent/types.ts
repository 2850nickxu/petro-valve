// Core domain types for the PO agent. The AI extraction schema (Phase 3) is a zod
// schema whose inferred type is assignable to ExtractedPo here, so the pipeline stays
// decoupled from the AI layer.

import type { VariantChoice } from "@/lib/bc/types";
import type { RulesThreadState } from "./rules/types";

export type { VariantChoice };

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
  | "line_parent_sku"
  | "line_blocked_by_assortment"
  | "line_qty_bounds"
  | "line_inventory_short"
  | "line_sku_description_conflict"
  | "line_unpriced"
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
  /** The PO quoted a parent (product-level) SKU: a child variant must be chosen. */
  parentSku?: boolean;
  /** Child variants to choose between, with their contract prices once priced. */
  variantChoices?: VariantChoice[];
  /** True number of children, before the display cap. */
  variantChoiceCount?: number;
  issues: ValidationIssueKind[];
  note?: string;
  /** Why the buyer's description contradicts the product their SKU matched (validate). */
  descriptionConflict?: string;
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
  /** A drafted reply is waiting for a person to approve it (rules HOLD). */
  | "held"
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
  /** Emails the original PO was forwarded to (below-contract price forwarding). */
  forwarded?: string[];
}

/** Where a decision step came from: a pipeline stage, a person, or the reminder sweep. */
export type DecisionStage =
  | "received"
  | "identify"
  | "classify"
  | "extract"
  | "resolve"
  | "price"
  | "validate"
  | "decide"
  | "draft"
  | "outbound"
  | "human"
  | "lifecycle";

/** A step's result, as a fixed vocabulary the UI maps to a badge. */
export type StepOutcome =
  | "known_account"
  | "unknown_sender"
  | "confidence_high"
  | "confidence_medium"
  | "confidence_low"
  | "ok"
  | "flagged"
  | "clarify"
  | "order"
  | "quote"
  | "rejected"
  | "needs_review"
  | "sent"
  | "failed"
  | "resolved_by_buyer"
  | "held"
  | "no_response"
  | "error";

/** The setting that drove a step, with its value at the time. */
export interface StepSetting {
  key: string;
  label: string;
  value: string;
}

/** A piece of evidence a step read. `value` is stored as read, so a later catalog change
 * doesn't alter the record. */
export interface SourceRef {
  system: "bigcommerce" | "email" | "settings";
  type: "customer" | "company" | "product" | "price" | "message" | "attachment" | "setting" | "order" | "quote";
  /** Record id, session message id ("m2") or setting key. */
  id?: string;
  label: string;
  value?: string | number;
  readAt?: string;
}

export interface AuditEntry {
  at: string;
  event: string;
  detail?: unknown;
  /** Free-text note attached by a staff operator (force/dismiss/add-note). */
  note?: string;
  /** Who took the action: "Sales agent" (older sessions stored "staff"). See people.ts. */
  actor?: string;
  /** Pipeline run (same numbering as SessionMessage.run). Staff and lifecycle events take
   * the latest run. Absent on events saved before decision steps existed. */
  run?: number;
  stage?: DecisionStage;
  /** Plain-language explanation, built by a code template from `detail` — never by the model. */
  summary?: string;
  outcome?: StepOutcome;
  setting?: StepSetting;
  sources?: SourceRef[];
}

/** Raw inbound email retained on the session so operators can read the original PO and
 * (for text-body POs) future sessions can be fully re-run. Populated once, on first sight. */
export interface InboundSnapshot {
  from: string;
  subject: string;
  bodyText: string;
  receivedAt?: string;
}

/** What a session message is. Inbound is the buyer writing in; the rest are sends. */
export type MessageKind =
  | "inbound"
  | "auto_reply"
  | "staff_reply"
  | "reminder"
  | "expiry"
  | "escalation_email"
  | "below_contract_forward";

/** Which reply template an agent auto-reply came from. */
export type MessagePurpose =
  | "rejection"
  | "triage"
  | "clarification"
  | "escalation_notice"
  | "first_order_confirm"
  | "order_confirmation"
  | "quote_confirmation"
  | "checkout_link_resend";

/** "captured" = a simulator sandbox send that was suppressed and never left the app.
 * "held" = a drafted reply waiting for a person to approve it; not sent. */
export type MessageStatus = "received" | "sent" | "failed" | "captured" | "held";

export interface MessageAttachment {
  filename: string;
  mediaType: string;
  size: number;
}

/** One email on the session, inbound or outbound, with the exact body received or sent. */
export interface SessionMessage {
  /** Ordinal within the session ("m1", "m2", …) — the log is append-only. */
  id: string;
  at: string;
  direction: "in" | "out";
  /** "buyer" = on the customer's thread; "internal" = rep/sales notifications, never sent to the buyer. */
  audience: "buyer" | "internal";
  kind: MessageKind;
  purpose?: MessagePurpose;
  status: MessageStatus;
  from?: string;
  to?: string;
  subject: string;
  text: string;
  attachments?: MessageAttachment[];
  /** Pipeline run this belongs to: run N is triggered by the Nth inbound message. */
  run?: number;
  /** Who sent an operator message: "Sales agent" (older sessions stored "staff"). */
  actor?: string;
  /** Why a send failed. */
  error?: string;
  providerMessageId?: string;
  providerThreadId?: string;
  /** RFC-2822 Message-ID / References headers, kept so later replies thread correctly. */
  rfcMessageId?: string;
  references?: string;
}

/** One row of the session search index. Fields after `updatedAt` arrived with summary
 * version 2; older index entries lack them until the search back-fills them. */
export interface SessionSummary {
  id: string;
  company: string;
  email: string;
  poNumber: string;
  state: PoSessionState;
  decision?: DecisionKind;
  createdAt: string;
  updatedAt: string;
  /** Summary format version (see session-summary.ts). */
  v?: number;
  /** One sentence on how the session stands: the latest decision or person action. */
  why?: string;
  /** Lines with no open issue, out of the lines read from the PO. */
  linesReady?: number;
  linesTotal?: number;
  /** Emails from the customer, and emails sent to them (internal emails excluded). */
  messagesIn?: number;
  messagesOut?: number;
  /** SKUs on the PO, for search. */
  skus?: string[];
  /** Created by the simulator, not real email. */
  simulated?: boolean;
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
  /** The original inbound email (first message on the thread). */
  inbound?: InboundSnapshot;
  buyer?: Buyer;
  extracted?: ExtractedPo;
  resolution?: ResolvedLine[];
  validation?: ValidationIssue[];
  decision?: Decision;
  result?: PoResult;
  escalation?: Escalation;
  audit: AuditEntry[];
  /** Every inbound and outbound email, oldest first. Absent on sessions saved before the log existed. */
  messages?: SessionMessage[];
  messageIds: string[];
  createdAt: string;
  updatedAt: string;
  /** Created by the simulator's conversation mode: nothing on it reached real email. */
  simulated?: boolean;
  /** Decision-rules state (simulated conversations only, for now). */
  rules?: RulesThreadState;
}
