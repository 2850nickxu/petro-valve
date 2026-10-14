// Types for the Petro Valve decision rules (docs/petrovalve-offline-po-decision-rules.md).
// The rules layer runs on top of the pipeline's identify → extract → resolve → price
// checks and answers with one of five actions. Today only the simulator uses it; real
// inbound mail keeps the pipeline's own decide step until the rules are signed off.

/** The five actions (doc §1). */
export type RulesAction = "AUTO_RESPOND" | "CLARIFY" | "HOLD" | "ESCALATE" | "NO_RESPONSE";

/** Reason codes (doc §7). `review_all_mode` is ours: the doc requires a code on every HOLD,
 * and review-all is the one HOLD the scenario catalog doesn't name. */
export type ReasonCode =
  | "not_in_catalog"
  | "low_match_confidence"
  | "low_intent_confidence"
  | "out_of_scope_intent"
  | "multiple_intents"
  | "named_rep"
  | "stock_short"
  | "missing_spec"
  | "unit_unclear"
  | "custom_or_substitute"
  | "documentation_required"
  | "commercial_terms"
  | "discount_request"
  | "past_price"
  | "pricing_anomaly"
  | "account_hold"
  | "account_unclear"
  | "payment_data"
  | "tax_exempt"
  | "compliance"
  | "complaint"
  | "human_requested"
  | "unreadable_file"
  | "external_link"
  | "checkout_issue"
  | "system_error"
  | "prompt_injection"
  | "staff_forward"
  | "non_english"
  | "high_value"
  | "unusual_quantity"
  | "currency"
  | "terms_check"
  | "large_request"
  | "multiple_pos"
  | "formal_quote"
  | "clarification_exhausted"
  | "rep_cc"
  | "bot_question"
  | "volume_spike"
  | "review_all_mode";

export type IntentType = "quote" | "order" | "availability" | "follow_up" | "other";

export type FollowUpKind = "accept" | "answer" | "change" | "price_pushback" | "none";

/** Message-content signals the classifier reports. Each maps to one or more scenarios. */
export const FLAG_KEYS = [
  "lead_time_question",
  "order_status_question",
  "technical_question",
  "return_or_complaint",
  "billing_question",
  "multiple_intents",
  "named_rep",
  "vendor_solicitation",
  "auto_reply",
  "spam_or_phishing",
  "discount_request",
  "past_price_or_quote_ref",
  "human_requested",
  "threat_or_legal",
  "prompt_injection",
  "bot_question",
  "substitute_requested",
  "modification_requested",
  "documentation_required",
  "kit_or_assembly",
  "formal_quote_requested",
  "price_hold_requested",
  "need_by_date",
  "blanket_order",
  "drop_ship",
  "change_existing_order",
  "checkout_issue",
  "cannot_use_checkout",
  "asks_to_place_order",
  "tax_exempt",
  "export_or_restricted_destination",
  "government_or_defense_clauses",
  "freight_or_expedite",
  "shipping_cost_question",
  "card_on_file",
  "net_terms_request",
  "mentions_attachment",
  "external_file_link",
  "customer_terms_and_conditions",
  "unit_of_measure_unclear",
  "non_usd_currency",
] as const;

export type FlagKey = (typeof FLAG_KEYS)[number];

export interface Classification {
  intent: IntentType;
  /** 0–1. */
  confidence: number;
  followUp: FollowUpKind;
  /** ISO 639-1 code of the message language ("en", "es", …). */
  language: string;
  flags: Record<FlagKey, boolean>;
  /** Card or bank numbers in the message. Always from the regex, never the model. */
  paymentData: boolean;
  /** Which classifier produced this. */
  source: "model" | "heuristic";
}

/** A scenario that matched this request, with the line it came from when it's per-line. */
export interface ScenarioHit {
  id: string;
  action: RulesAction;
  code?: ReasonCode;
  /** 1-based PO line, for line scenarios. */
  line?: number;
}

/** What the reply for this action is built from. HOLD keeps the kind of the reply it holds. */
export type ReplyKind = "quote" | "resend_link" | "clarify" | "ack" | "none";

export type RulesLineStatus = "ok" | "clarify" | "hold" | "escalate";

export interface RulesOutcome {
  action: RulesAction;
  scenarios: ScenarioHit[];
  /** Empty for AUTO_RESPOND and CLARIFY, non-empty for HOLD and ESCALATE (doc §7). */
  reasonCodes: ReasonCode[];
  /** One per PO line. */
  lineStatuses: RulesLineStatus[];
  /** The scenario that set each line's status. */
  lineScenarios: string[];
  replyKind: ReplyKind;
  /** Why a person is needed and the recommended next step. */
  notesForRep: string;
}

export interface DecisionRecordLine {
  requested_text: string;
  matched_sku: string | null;
  match_confidence: number;
  quantity: number | null;
  unit_price: number | null;
  stock_on_hand: number | null;
  line_status: RulesLineStatus;
  scenario: string;
}

/** The decision record (doc §7). For ESCALATE it is also the handoff ticket payload. */
export interface DecisionRecord {
  message_id: string;
  thread_id: string;
  action: RulesAction;
  matched_scenarios: string[];
  reason_codes: ReasonCode[];
  intent: { type: IntentType; confidence: number };
  customer: {
    customer_id: string | null;
    company: string | null;
    guest: boolean;
    name: string;
    email: string;
  };
  po_number: string | null;
  lines: DecisionRecordLine[];
  request_total: number;
  checkout_url: string | null;
  clarification_rounds_used: number;
  reply: { to: string; subject: string; body: string } | null;
  /** What the customer was actually sent this turn (the acknowledgment on an escalation). */
  already_sent_to_customer: string | null;
  notes_for_rep: string;
  /** Pipeline run this record belongs to. */
  run: number;
  at: string;
  /** How the reply left: sent (captured in the simulator), held as a draft, or only previewed. */
  reply_status: "sent" | "held" | "preview" | "none";
}

/** Rules state carried on a simulated session between turns. */
export interface RulesThreadState {
  records: DecisionRecord[];
  clarificationRoundsUsed: number;
  /** A person owns the thread (escalated, or staff replied): later customer mail gets NO_RESPONSE (T6). */
  humanOwned: boolean;
  lastAction?: RulesAction;
  /** The quote sent (or drafted) on this thread, so "looks good" can resend its link (T1). */
  quote?: { quoteId: number; quoteNumber?: string; checkoutUrl?: string; quoteUrl?: string };
  /** The hold-every-reply toggle the conversation was run with. */
  reviewAll: boolean;
  /** Clarify scenarios the customer has answered (Q2, C11, P15), so they aren't asked again. */
  answered?: string[];
}
