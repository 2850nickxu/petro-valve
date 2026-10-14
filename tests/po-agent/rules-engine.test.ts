import { describe, it, expect } from "vitest";
import { decideByRules, type RulesInput } from "@/lib/po-agent/rules/engine";
import { getRulesConfig, type RulesConfig } from "@/lib/po-agent/rules/config";
import { FLAG_KEYS, type Classification, type FlagKey } from "@/lib/po-agent/rules/types";
import type { ExtractedPo, ResolvedLine, ValidationIssueKind } from "@/lib/po-agent/types";

// The decision procedure (docs/petrovalve-offline-po-decision-rules.md §2) as a table:
// one row per scenario the engine implements → the action and reason code it produces.

const CFG: RulesConfig = getRulesConfig({}, { reviewAll: false });

function classification(over: Partial<Classification> = {}, flags: FlagKey[] = []): Classification {
  const f = Object.fromEntries(FLAG_KEYS.map((k) => [k, flags.includes(k)])) as Record<FlagKey, boolean>;
  return { intent: "quote", confidence: 0.97, followUp: "none", language: "en", flags: f, paymentData: false, source: "heuristic", ...over };
}

function line(over: Partial<ResolvedLine> & { sku?: string | null; qty?: number | null; stated?: number | null } = {}): ResolvedLine {
  const { sku = "WIDGET-100", qty = 10, stated = null, ...rest } = over;
  return {
    line: { rawText: `SKU: ${sku} Qty: ${qty}`, sku, description: null, quantity: qty, statedUnitPrice: stated, statedTotal: null },
    productId: 80,
    variantId: 64,
    matchedSku: sku ?? undefined,
    productName: "Widget",
    calculatedUnitPrice: 9.84,
    inventoryTracked: true,
    inventoryLevel: 50,
    issues: [],
    ...rest,
  };
}

const PO: ExtractedPo = {
  poNumber: "PO-1",
  buyerNote: null,
  paymentIntent: "unspecified",
  requestedShipDate: null,
  shipTo: null,
  billTo: null,
  lines: [],
  currency: "USD",
  confidence: "high",
};

function input(over: Partial<RulesInput> = {}): RulesInput {
  const resolved = over.resolved ?? [line()];
  return {
    classification: classification(),
    sender: { email: "buyer@acme.com", staff: false, freeDomain: false },
    customer: { kind: "known", accountHold: false },
    extracted: { ...PO, lines: resolved.map((r) => r.line) },
    resolved,
    newShipTo: false,
    hasAttachments: false,
    requestTotal: resolved.reduce((s, r) => s + (r.calculatedUnitPrice ?? 0) * (r.line.quantity ?? 0), 0),
    thread: { humanOwned: false, clarificationRoundsUsed: 0, hasQuote: false },
    ...over,
  };
}

const issues = (...k: ValidationIssueKind[]) => ({ issues: k });

describe("decideByRules — scenario table", () => {
  const rows: Array<[string, Partial<RulesInput>, string, string | null]> = [
    ["I1 clear quote, P1 exact SKU", {}, "AUTO_RESPOND", null],
    ["C2 guest", { customer: { kind: "guest", accountHold: false } }, "AUTO_RESPOND", null],
    ["I3 availability", { classification: classification({ intent: "availability" }) }, "AUTO_RESPOND", null],
    ["I4 lead time", { classification: classification({}, ["lead_time_question"]) }, "ESCALATE", "out_of_scope_intent"],
    ["I5 order status", { classification: classification({}, ["order_status_question"]) }, "ESCALATE", "out_of_scope_intent"],
    ["I7 complaint", { classification: classification({}, ["return_or_complaint"]) }, "ESCALATE", "complaint"],
    ["I9 multiple intents", { classification: classification({}, ["multiple_intents"]) }, "ESCALATE", "multiple_intents"],
    ["I10 low confidence", { classification: classification({ confidence: 0.5 }) }, "ESCALATE", "low_intent_confidence"],
    ["I10 other intent", { classification: classification({ intent: "other" }) }, "ESCALATE", "low_intent_confidence"],
    ["I11 staff forward", { sender: { email: "mike@petrovalve.com", staff: true, freeDomain: false } }, "HOLD", "staff_forward"],
    ["I12 named rep", { classification: classification({}, ["named_rep"]) }, "ESCALATE", "named_rep"],
    ["I13 non-English", { classification: classification({ language: "es" }) }, "HOLD", "non_english"],
    ["I14 vendor", { classification: classification({}, ["vendor_solicitation"]) }, "NO_RESPONSE", null],
    ["I15 auto-reply", { classification: classification({}, ["auto_reply"]) }, "NO_RESPONSE", null],
    ["I16 spam", { classification: classification({}, ["spam_or_phishing"]) }, "NO_RESPONSE", null],
    ["P2 not in catalog", { resolved: [line({ productId: undefined, ...issues("line_unresolved") })] }, "ESCALATE", "not_in_catalog"],
    ["P7 description only", { resolved: [line({ sku: null, productId: undefined, ...issues("line_unresolved") })] }, "ESCALATE", "low_match_confidence"],
    ["P9 stock short", { resolved: [line({ ...issues("line_inventory_short") })] }, "ESCALATE", "stock_short"],
    ["P10 disabled", { resolved: [line({ ...issues("line_unresolved") })] }, "ESCALATE", "not_in_catalog"],
    ["P11 substitute", { classification: classification({}, ["substitute_requested"]) }, "ESCALATE", "custom_or_substitute"],
    ["P13 documentation", { classification: classification({}, ["documentation_required"]) }, "ESCALATE", "documentation_required"],
    ["P14 parent SKU", { resolved: [line({ parentSku: true, ...issues("line_parent_sku") })] }, "ESCALATE", "missing_spec"],
    ["P15 duplicate SKU", { resolved: [line(), line()] }, "CLARIFY", null],
    ["Q2 target price below catalog", { resolved: [line({ stated: 1 })] }, "CLARIFY", null],
    ["Q3 past price", { classification: classification({}, ["past_price_or_quote_ref"]) }, "ESCALATE", "past_price"],
    ["Q4 discount", { classification: classification({}, ["discount_request"]) }, "ESCALATE", "discount_request"],
    ["Q5 unpriced", { resolved: [line({ calculatedUnitPrice: undefined, ...issues("line_unpriced") })] }, "ESCALATE", "pricing_anomaly"],
    ["Q6 high value", { requestTotal: 60000 }, "HOLD", "high_value"],
    ["Q7 unusual quantity", { resolved: [line({ qty: 10000, inventoryTracked: false })] }, "HOLD", "unusual_quantity"],
    ["Q8 missing quantity", { resolved: [line({ qty: null, ...issues("missing_quantity") })] }, "CLARIFY", null],
    ["Q9 unit unclear", { classification: classification({}, ["unit_of_measure_unclear"]) }, "ESCALATE", "unit_unclear"],
    ["Q10 currency", { classification: classification({}, ["non_usd_currency"]) }, "HOLD", "currency"],
    ["Q11 shipping cost", { classification: classification({}, ["shipping_cost_question"]) }, "AUTO_RESPOND", null],
    ["Q12 freight", { classification: classification({}, ["freight_or_expedite"]) }, "ESCALATE", "commercial_terms"],
    ["C5 account hold", { customer: { kind: "known", accountHold: true } }, "ESCALATE", "account_hold"],
    ["C7 card on file", { classification: classification({}, ["card_on_file"]) }, "AUTO_RESPOND", null],
    ["C8 payment data", { classification: classification({ paymentData: true }) }, "ESCALATE", "payment_data"],
    ["C9 net terms", { classification: classification({}, ["net_terms_request"]) }, "HOLD", "terms_check"],
    ["C10 tax exempt", { classification: classification({}, ["tax_exempt"]) }, "ESCALATE", "tax_exempt"],
    ["C11 new ship-to", { newShipTo: true }, "CLARIFY", null],
    ["C13 DFARS", { classification: classification({}, ["government_or_defense_clauses"]) }, "ESCALATE", "compliance"],
    ["A2 large request", { resolved: Array.from({ length: 51 }, (_, i) => line({ sku: `SKU-${i}`, matchedSku: `SKU-${i}` })) }, "HOLD", "large_request"],
    ["A5 customer T&Cs", { classification: classification({}, ["customer_terms_and_conditions"]) }, "ESCALATE", "commercial_terms"],
    ["A10 missing attachment", { classification: classification({}, ["mentions_attachment"]) }, "CLARIFY", null],
    ["A11 external link", { classification: classification({}, ["external_file_link"]) }, "ESCALATE", "external_link"],
    ["O3 formal quote", { classification: classification({}, ["formal_quote_requested"]) }, "HOLD", "formal_quote"],
    ["O4 price hold", { classification: classification({}, ["price_hold_requested"]) }, "ESCALATE", "commercial_terms"],
    ["O5 need-by date", { classification: classification({}, ["need_by_date"]) }, "ESCALATE", "commercial_terms"],
    ["O8 change existing order", { classification: classification({}, ["change_existing_order"]) }, "ESCALATE", "out_of_scope_intent"],
    ["O9 asks us to place it", { classification: classification({}, ["asks_to_place_order"]) }, "AUTO_RESPOND", null],
    ["O9 can't use checkout", { classification: classification({}, ["asks_to_place_order", "cannot_use_checkout"]) }, "ESCALATE", "checkout_issue"],
    ["O10 checkout link problem", { classification: classification({}, ["checkout_issue"]) }, "ESCALATE", "checkout_issue"],
    ["T8 wants a person", { classification: classification({}, ["human_requested"]) }, "ESCALATE", "human_requested"],
    ["T9 legal language", { classification: classification({}, ["threat_or_legal"]) }, "ESCALATE", "complaint"],
    ["T10 bot question", { classification: classification({}, ["bot_question"]) }, "HOLD", "bot_question"],
    ["T12 prompt injection", { classification: classification({}, ["prompt_injection"]) }, "ESCALATE", "prompt_injection"],
    ["T14 store down", { systemError: "store" }, "ESCALATE", "system_error"],
    ["T15 model down", { systemError: "model" }, "ESCALATE", "system_error"],
  ];

  it.each(rows)("%s", (_name, over, action, code) => {
    const o = decideByRules(input(over), CFG);
    expect(o.action).toBe(action);
    if (code) expect(o.reasonCodes).toContain(code);
    else expect(o.reasonCodes).toEqual([]);
  });
});

describe("decideByRules — precedence and thread rules", () => {
  it("escalates the whole request when any line escalates (no partial quotes, P3)", () => {
    const o = decideByRules(input({ resolved: [line(), line({ sku: "NOPE-1", productId: undefined, ...issues("line_unresolved") })] }), CFG);
    expect(o.action).toBe("ESCALATE");
    expect(o.scenarios.map((h) => h.id)).toEqual(expect.arrayContaining(["P1", "P2", "P3"]));
    expect(o.lineStatuses).toEqual(["ok", "escalate"]);
    expect(o.notesForRep).toMatch(/1 of 2 lines matched and priced/);
  });

  it("the most restrictive action wins: NO_RESPONSE > ESCALATE > HOLD > CLARIFY", () => {
    expect(decideByRules(input({ classification: classification({}, ["discount_request", "net_terms_request"]) }), CFG).action).toBe("ESCALATE");
    expect(decideByRules(input({ classification: classification({}, ["net_terms_request"]), newShipTo: true }), CFG).action).toBe("HOLD");
    expect(decideByRules(input({ classification: classification({}, ["auto_reply", "discount_request"]) }), CFG).action).toBe("NO_RESPONSE");
  });

  it("T6: once a person owns the thread, the agent never answers", () => {
    const o = decideByRules(input({ thread: { humanOwned: true, clarificationRoundsUsed: 0, hasQuote: false, priorAction: "ESCALATE" } }), CFG);
    expect(o.action).toBe("NO_RESPONSE");
    expect(o.scenarios.map((h) => h.id)).toEqual(["T6"]);
    expect(o.replyKind).toBe("none");
  });

  it("T5: a second clarification becomes a held draft of the question", () => {
    const o = decideByRules(
      input({
        resolved: [line({ qty: null, ...issues("missing_quantity") })],
        classification: classification({ intent: "follow_up", followUp: "answer" }),
        thread: { humanOwned: false, clarificationRoundsUsed: 1, hasQuote: false, priorAction: "CLARIFY" },
      }),
      CFG,
    );
    expect(o.action).toBe("HOLD");
    expect(o.reasonCodes).toEqual(["clarification_exhausted"]);
    expect(o.replyKind).toBe("clarify");
  });

  it("review-all turns an auto-reply into a held quote draft", () => {
    const o = decideByRules(input(), { ...CFG, reviewAll: true });
    expect(o.action).toBe("HOLD");
    expect(o.reasonCodes).toEqual(["review_all_mode"]);
    expect(o.replyKind).toBe("quote");
  });

  it("review-all never softens an escalation", () => {
    const o = decideByRules(input({ classification: classification({}, ["discount_request"]) }), { ...CFG, reviewAll: true });
    expect(o.action).toBe("ESCALATE");
    expect(o.reasonCodes).not.toContain("review_all_mode");
  });

  it("T1: accepting a sent quote resends its link", () => {
    const o = decideByRules(
      input({
        classification: classification({ intent: "follow_up", followUp: "accept" }),
        thread: { humanOwned: false, clarificationRoundsUsed: 0, hasQuote: true, priorAction: "AUTO_RESPOND" },
      }),
      CFG,
    );
    expect(o.action).toBe("AUTO_RESPOND");
    expect(o.replyKind).toBe("resend_link");
  });

  it("T2/T3: an answer or a change is reprocessed and quoted again", () => {
    const thread = { humanOwned: false, clarificationRoundsUsed: 1, hasQuote: false, priorAction: "CLARIFY" as const };
    const answer = decideByRules(input({ classification: classification({ intent: "follow_up", followUp: "answer" }), thread }), CFG);
    expect(answer.action).toBe("AUTO_RESPOND");
    expect(answer.scenarios.map((h) => h.id)).toContain("T2");
    const change = decideByRules(input({ classification: classification({ intent: "follow_up", followUp: "change" }), thread }), CFG);
    expect(change.scenarios.map((h) => h.id)).toContain("T3");
    expect(change.replyKind).toBe("quote");
  });

  it("T4: price pushback on a reply escalates as a discount request", () => {
    const o = decideByRules(
      input({
        classification: classification({ intent: "follow_up", followUp: "price_pushback" }),
        thread: { humanOwned: false, clarificationRoundsUsed: 0, hasQuote: true, priorAction: "AUTO_RESPOND" },
      }),
      CFG,
    );
    expect(o.action).toBe("ESCALATE");
    expect(o.scenarios.map((h) => h.id)).toContain("T4");
  });

  it("acknowledges an escalation only when the setting is on", () => {
    const esc = input({ classification: classification({}, ["human_requested"]) });
    expect(decideByRules(esc, CFG).replyKind).toBe("ack");
    expect(decideByRules(esc, { ...CFG, escalationAcknowledgment: false }).replyKind).toBe("none");
  });

  it("free-mail guests are C4, other guests C2", () => {
    const free = decideByRules(input({ customer: { kind: "guest", accountHold: false }, sender: { email: "a@gmail.com", staff: false, freeDomain: true } }), CFG);
    expect(free.scenarios.map((h) => h.id)).toContain("C4");
  });
});
