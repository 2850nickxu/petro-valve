import type { ReasonCode, RulesAction } from "./types";

// The scenario catalog (doc §4), one entry per scenario ID. IDs match the doc so a decision
// can be traced back to its row. `code` is the reason code recorded when the scenario
// drives a HOLD or ESCALATE. Labels are staff-facing and short.

export interface ScenarioDef {
  action: RulesAction;
  code?: ReasonCode;
  label: string;
}

export const SCENARIOS: Record<string, ScenarioDef> = {
  // 4.1 Intake and classification
  I1: { action: "AUTO_RESPOND", label: "Clear quote request" },
  I2: { action: "AUTO_RESPOND", label: "Website quote or contact form" },
  I3: { action: "AUTO_RESPOND", label: "Availability question" },
  I4: { action: "ESCALATE", code: "out_of_scope_intent", label: "Lead time or ship-date question" },
  I5: { action: "ESCALATE", code: "out_of_scope_intent", label: "Order status or tracking" },
  I6: { action: "ESCALATE", code: "out_of_scope_intent", label: "Technical or engineering question" },
  I7: { action: "ESCALATE", code: "complaint", label: "Return, warranty or complaint" },
  I8: { action: "ESCALATE", code: "out_of_scope_intent", label: "Billing, invoice or credit question" },
  I9: { action: "ESCALATE", code: "multiple_intents", label: "Several requests in one message" },
  I10: { action: "ESCALATE", code: "low_intent_confidence", label: "Intent unclear" },
  I11: { action: "HOLD", code: "staff_forward", label: "Staff forwarded a customer request" },
  I12: { action: "ESCALATE", code: "named_rep", label: "Addressed to a named rep" },
  I13: { action: "HOLD", code: "non_english", label: "Not in English" },
  I14: { action: "NO_RESPONSE", label: "Vendor solicitation or marketing" },
  I15: { action: "NO_RESPONSE", label: "Auto-reply, out-of-office or bounce" },
  I16: { action: "NO_RESPONSE", label: "Spam or phishing" },

  // 4.2 SKU and product matching
  P1: { action: "AUTO_RESPOND", label: "Exact SKU, in catalog, enough stock" },
  P2: { action: "ESCALATE", code: "not_in_catalog", label: "SKU not in the online catalog" },
  P3: { action: "ESCALATE", code: "not_in_catalog", label: "Mix of catalog and non-catalog lines" },
  P4: { action: "CLARIFY", label: "Partial SKU with one likely match" },
  P5: { action: "CLARIFY", label: "Several plausible matches" },
  P6: { action: "CLARIFY", label: "Description with one strong match" },
  P7: { action: "ESCALATE", code: "low_match_confidence", label: "No confident product match" },
  P8: { action: "ESCALATE", code: "not_in_catalog", label: "Manufacturer or customer part number" },
  P9: { action: "ESCALATE", code: "stock_short", label: "Not enough stock" },
  P10: { action: "ESCALATE", code: "not_in_catalog", label: "Product disabled or hidden" },
  P11: { action: "ESCALATE", code: "custom_or_substitute", label: "Substitute or equal requested" },
  P12: { action: "ESCALATE", code: "custom_or_substitute", label: "Modification requested" },
  P13: { action: "ESCALATE", code: "documentation_required", label: "Documentation required" },
  P14: { action: "ESCALATE", code: "missing_spec", label: "Required option missing" },
  P15: { action: "CLARIFY", label: "Same SKU on more than one line" },
  P16: { action: "ESCALATE", code: "custom_or_substitute", label: "Kit or assembly" },

  // 4.3 Pricing and quantity
  Q1: { action: "AUTO_RESPOND", label: "Catalog price applies" },
  Q2: { action: "CLARIFY", label: "Target price below catalog" },
  Q3: { action: "ESCALATE", code: "past_price", label: "Old price or past quote cited" },
  Q4: { action: "ESCALATE", code: "discount_request", label: "Discount or best price asked" },
  Q5: { action: "ESCALATE", code: "pricing_anomaly", label: "Store price missing or $0" },
  Q6: { action: "HOLD", code: "high_value", label: "Request total over the hold limit" },
  Q7: { action: "HOLD", code: "unusual_quantity", label: "Unusual quantity" },
  Q8: { action: "CLARIFY", label: "Quantity missing" },
  Q9: { action: "ESCALATE", code: "unit_unclear", label: "Unit of measure unclear" },
  Q10: { action: "HOLD", code: "currency", label: "Non-USD currency" },
  Q11: { action: "AUTO_RESPOND", label: "Standard shipping cost question" },
  Q12: { action: "ESCALATE", code: "commercial_terms", label: "Freight, expedite or carrier account" },
  // Not in the doc: a store order-quantity limit. Mirrors the pipeline, which asks the buyer.
  QB: { action: "CLARIFY", label: "Outside the store's order-quantity limits (not in the doc)" },

  // 4.4 Customer identity and account
  C1: { action: "AUTO_RESPOND", label: "Known customer" },
  C2: { action: "AUTO_RESPOND", label: "Guest (no account)" },
  C3: { action: "AUTO_RESPOND", label: "Unknown person at a known customer's domain" },
  C4: { action: "AUTO_RESPOND", label: "Free email domain, treated as guest" },
  C5: { action: "ESCALATE", code: "account_hold", label: "Account on hold or not approved" },
  C6: { action: "ESCALATE", code: "account_unclear", label: "Email matches several accounts" },
  C7: { action: "AUTO_RESPOND", label: "Use my card on file" },
  C8: { action: "ESCALATE", code: "payment_data", label: "Card or bank numbers in the message" },
  C9: { action: "HOLD", code: "terms_check", label: "Wants net terms or invoice" },
  C10: { action: "ESCALATE", code: "tax_exempt", label: "Tax-exempt request" },
  C11: { action: "CLARIFY", label: "New or different ship-to address" },
  C12: { action: "ESCALATE", code: "compliance", label: "Export or restricted destination" },
  C13: { action: "ESCALATE", code: "compliance", label: "Government or defense clauses" },

  // 4.5 Attachments and parsing
  A1: { action: "AUTO_RESPOND", label: "Spreadsheet with SKU and qty columns" },
  A2: { action: "HOLD", code: "large_request", label: "More lines than the hold limit" },
  A3: { action: "AUTO_RESPOND", label: "Text-based PDF PO" },
  A4: { action: "ESCALATE", code: "unreadable_file", label: "Scanned, photo or handwriting" },
  A5: { action: "ESCALATE", code: "commercial_terms", label: "PO includes customer terms" },
  A6: { action: "ESCALATE", code: "unreadable_file", label: "File can't be read" },
  A7: { action: "ESCALATE", code: "custom_or_substitute", label: "Engineering drawing or custom spec" },
  A8: { action: "CLARIFY", label: "Body and attachment disagree" },
  A9: { action: "HOLD", code: "multiple_pos", label: "Several POs in one message" },
  A10: { action: "CLARIFY", label: "Attachment mentioned but missing" },
  A11: { action: "ESCALATE", code: "external_link", label: "Link to an external file share" },

  // 4.6 Orders, quotes and commercial terms
  O1: { action: "AUTO_RESPOND", label: "PO with a PO number" },
  O2: { action: "AUTO_RESPOND", label: "Pricing request with no PO number" },
  O3: { action: "HOLD", code: "formal_quote", label: "Formal quote document requested" },
  O4: { action: "ESCALATE", code: "commercial_terms", label: "Price hold or validity period" },
  O5: { action: "ESCALATE", code: "commercial_terms", label: "Hard need-by date" },
  O6: { action: "ESCALATE", code: "commercial_terms", label: "Blanket order or releases" },
  O7: { action: "ESCALATE", code: "commercial_terms", label: "Drop ship or blind ship" },
  O8: { action: "ESCALATE", code: "out_of_scope_intent", label: "Change or cancel an existing order" },
  O9: { action: "AUTO_RESPOND", label: "Asks us to place the order" },
  O9X: { action: "ESCALATE", code: "checkout_issue", label: "Can't use checkout" },
  O10: { action: "ESCALATE", code: "checkout_issue", label: "Checkout link problem" },

  // 4.7 Follow-ups, threads and system failures
  T1: { action: "AUTO_RESPOND", label: "Customer accepts the quote" },
  T2: { action: "AUTO_RESPOND", label: "Customer answered our question" },
  T3: { action: "AUTO_RESPOND", label: "Customer changed items or quantities" },
  T4: { action: "ESCALATE", code: "discount_request", label: "Customer pushes back on price" },
  T5: { action: "HOLD", code: "clarification_exhausted", label: "Still unclear after one clarification" },
  T6: { action: "NO_RESPONSE", label: "A person owns this thread" },
  T7: { action: "HOLD", code: "rep_cc", label: "A rep is CC'd" },
  T8: { action: "ESCALATE", code: "human_requested", label: "Customer asks for a person" },
  T9: { action: "ESCALATE", code: "complaint", label: "Upset, threatening or legal language" },
  T10: { action: "HOLD", code: "bot_question", label: "Asks if this is automated" },
  T11: { action: "AUTO_RESPOND", label: "Duplicate request" },
  T12: { action: "ESCALATE", code: "prompt_injection", label: "Message tries to instruct the agent" },
  T13: { action: "HOLD", code: "volume_spike", label: "Unusual volume from one sender" },
  T14: { action: "ESCALATE", code: "system_error", label: "Store unavailable" },
  T15: { action: "ESCALATE", code: "system_error", label: "Model unavailable" },
};

/** Most restrictive first (doc §1). */
export const PRECEDENCE: RulesAction[] = ["NO_RESPONSE", "ESCALATE", "HOLD", "CLARIFY", "AUTO_RESPOND"];

export function rank(action: RulesAction): number {
  return PRECEDENCE.length - PRECEDENCE.indexOf(action);
}

/** The more restrictive of two actions. */
export function stricter(a: RulesAction, b: RulesAction): RulesAction {
  return rank(a) >= rank(b) ? a : b;
}

export function scenarioLabel(id: string): string {
  return SCENARIOS[id]?.label ?? id;
}

/** Short staff-facing phrases for reason codes. */
export const REASON_TEXT: Record<ReasonCode, string> = {
  not_in_catalog: "item not sellable online",
  low_match_confidence: "no confident product match",
  low_intent_confidence: "intent unclear",
  out_of_scope_intent: "request the agent doesn't handle",
  multiple_intents: "several requests in one message",
  named_rep: "addressed to a named rep",
  stock_short: "not enough stock",
  missing_spec: "required option missing",
  unit_unclear: "unit of measure unclear",
  custom_or_substitute: "custom item or substitute",
  documentation_required: "documentation required",
  commercial_terms: "commercial terms",
  discount_request: "discount or negotiation",
  past_price: "cites a past price or quote",
  pricing_anomaly: "store price missing",
  account_hold: "account on hold",
  account_unclear: "account unclear",
  payment_data: "payment details in the message",
  tax_exempt: "tax-exempt request",
  compliance: "compliance terms",
  complaint: "complaint",
  human_requested: "customer asked for a person",
  unreadable_file: "file can't be read",
  external_link: "external file link",
  checkout_issue: "checkout problem",
  system_error: "system error",
  prompt_injection: "message tried to instruct the agent",
  staff_forward: "forwarded by staff",
  non_english: "not in English",
  high_value: "high value",
  unusual_quantity: "unusual quantity",
  currency: "non-USD currency",
  terms_check: "net terms requested",
  large_request: "large request",
  multiple_pos: "several POs",
  formal_quote: "formal quote requested",
  clarification_exhausted: "still unclear after one clarification",
  rep_cc: "rep CC'd",
  bot_question: "asked if this is automated",
  volume_spike: "unusual volume",
  review_all_mode: "review-all mode is on",
};
