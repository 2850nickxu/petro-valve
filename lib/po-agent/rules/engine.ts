import { money } from "../ai/respond";
import { submittableLines } from "../core/resolve";
import type { ExtractedPo, ResolvedLine } from "../types";
import { SCENARIOS, REASON_TEXT, stricter } from "./catalog";
import type { RulesConfig } from "./config";
import type {
  Classification,
  ReasonCode,
  ReplyKind,
  RulesAction,
  RulesLineStatus,
  RulesOutcome,
  ScenarioHit,
} from "./types";

// The decision procedure (doc §2), as a pure function over facts the pipeline already
// gathered: the classification, who the sender is, the PO lines as matched and priced
// against the store, and the thread so far. Every scenario that applies is recorded; the
// action is the most restrictive one (doc §1 precedence), then the clarification limit
// (T5) and review-all mode turn a reply into a held draft.

export interface RulesInput {
  classification: Classification;
  sender: { email: string; staff: boolean; freeDomain: boolean };
  customer: { kind: "known" | "guest"; accountHold: boolean };
  extracted: ExtractedPo;
  resolved: ResolvedLine[];
  /** The PO gives a ship-to that differs from the account's default (C11). */
  newShipTo: boolean;
  hasAttachments: boolean;
  /** Store-priced total of the lines that can be quoted. */
  requestTotal: number;
  thread: {
    priorAction?: RulesAction;
    humanOwned: boolean;
    clarificationRoundsUsed: number;
    hasQuote: boolean;
    /** Clarify scenarios the customer has answered on this thread (Q2, C11, P15): their
     * answer resolves them, so the reprocessed request doesn't ask again. */
    answered?: string[];
  };
  /** The store or the model failed after retries (T14 / T15). */
  systemError?: "store" | "model";
}

const FREE_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "aol.com",
  "icloud.com",
  "me.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
]);

export function emailDomain(email: string): string {
  return (email.split("@")[1] ?? "").trim().toLowerCase();
}

export function isFreeDomain(email: string): boolean {
  return FREE_DOMAINS.has(emailDomain(email));
}

export function isStaffSender(email: string, cfg: Pick<RulesConfig, "staffDomains">): boolean {
  const d = emailDomain(email);
  return Boolean(d) && cfg.staffDomains.some((s) => d === s || d.endsWith(`.${s}`));
}

const STATUS: Record<RulesAction, RulesLineStatus> = {
  AUTO_RESPOND: "ok",
  CLARIFY: "clarify",
  HOLD: "hold",
  ESCALATE: "escalate",
  NO_RESPONSE: "ok",
};

/** The next step a person should take, by the first reason code. */
const NEXT_STEP: Partial<Record<ReasonCode, string>> = {
  not_in_catalog: "quote the matched lines and source the rest",
  low_match_confidence: "confirm which products the customer means, then quote",
  low_intent_confidence: "read the message and reply or route it",
  out_of_scope_intent: "answer the customer's question directly",
  multiple_intents: "handle each request, including the quotable part",
  named_rep: "route to the named rep",
  stock_short: "check supply for the short lines and quote what can ship",
  missing_spec: "ask for the missing option, then quote",
  unit_unclear: "confirm the unit of measure, then quote",
  custom_or_substitute: "review the custom or substitute request",
  documentation_required: "arrange the requested documents",
  commercial_terms: "review the commercial terms before quoting",
  discount_request: "decide whether to offer pricing; the agent never changes catalog prices",
  past_price: "check the cited price or quote",
  pricing_anomaly: "fix the store price, then quote",
  account_hold: "check the account status",
  account_unclear: "confirm which account the customer buys for",
  payment_data: "contact the customer about payment without repeating the numbers",
  tax_exempt: "verify the exemption certificate",
  compliance: "run the compliance review",
  complaint: "contact the customer about the complaint",
  human_requested: "contact the customer",
  external_link: "ask for the file as an attachment",
  checkout_issue: "help the customer complete checkout",
  system_error: "retry, or quote by hand",
  prompt_injection: "review the message; it tried to instruct the agent",
};

function notesFor(action: RulesAction, codes: ReasonCode[], input: RulesInput, hits: ScenarioHit[]): string {
  const reasons = codes.map((c) => REASON_TEXT[c]).join(", ");
  const quotable = submittableLines(input.resolved).filter((l) => l.calculatedUnitPrice != null).length;
  const total = input.resolved.length;
  switch (action) {
    case "ESCALATE": {
      const lines = total ? ` ${quotable} of ${total} lines matched and priced (${money(input.requestTotal)}).` : "";
      const next = NEXT_STEP[codes[0]] ?? "review the request";
      return `Needs a person: ${reasons}.${lines} Recommended next step: ${next}.`;
    }
    case "HOLD":
      return `Draft held for review: ${reasons}. Approve it as written, edit it, or take over the thread.`;
    case "CLARIFY":
      return "Asked the customer one clarifying question. No action needed unless they don't reply.";
    case "NO_RESPONSE":
      return hits.some((h) => h.id === "T6")
        ? "A person owns this thread. Nothing was sent; the message is on the thread for them."
        : "Logged only: not a customer request. Nothing was sent.";
    default:
      return "Quoted automatically. No action needed.";
  }
}

const IN_SCOPE = new Set(["quote", "order", "availability", "follow_up"]);

export function decideByRules(input: RulesInput, cfg: RulesConfig): RulesOutcome {
  const hits: ScenarioHit[] = [];
  const add = (id: string, line?: number) => {
    const d = SCENARIOS[id];
    if (!d) throw new Error(`Unknown scenario ${id}`);
    if (input.thread.answered?.includes(id)) return;
    if (hits.some((h) => h.id === id && h.line === line)) return;
    hits.push({ id, action: d.action, ...(d.code ? { code: d.code } : {}), ...(line ? { line } : {}) });
  };
  const c = input.classification;
  const f = c.flags;
  const t = input.thread;

  const finish = () => finalize(input, cfg, hits);

  // T14 / T15: never quote from a guess.
  if (input.systemError) {
    add(input.systemError === "store" ? "T14" : "T15");
    return finish();
  }

  // 1. Thread ownership (T6).
  if (t.humanOwned) {
    add("T6");
    return finish();
  }

  // 2. Noise (I14–I16).
  if (f.auto_reply) add("I15");
  if (f.vendor_solicitation) add("I14");
  if (f.spam_or_phishing) add("I16");
  if (hits.length) return finish();

  // 3. Guardrails.
  if (c.paymentData) add("C8");
  if (f.prompt_injection) add("T12");
  if (f.discount_request || c.followUp === "price_pushback") add(t.priorAction ? "T4" : "Q4");
  if (f.past_price_or_quote_ref) add("Q3");
  if (input.customer.accountHold) add("C5");
  if (f.customer_terms_and_conditions) add("A5");
  if (f.export_or_restricted_destination) add("C12");
  if (f.government_or_defense_clauses) add("C13");
  if (f.return_or_complaint) add("I7");
  if (f.threat_or_legal) add("T9");
  if (f.human_requested) add("T8");

  // 4. Intent.
  if (f.lead_time_question) add("I4");
  if (f.order_status_question) add("I5");
  if (f.technical_question) add("I6");
  if (f.billing_question) add("I8");
  if (f.multiple_intents) add("I9");
  if (f.named_rep) add("I12");
  if (input.sender.staff) add("I11");
  if (c.language && c.language !== "en") add("I13");
  if (f.bot_question) add("T10");
  const followUp = c.intent === "follow_up" || Boolean(t.priorAction);
  const inScope = IN_SCOPE.has(c.intent) || followUp;
  const explained = hits.some((h) => h.action !== "AUTO_RESPOND");
  if ((!inScope && !explained) || c.confidence < cfg.intentConfidenceMin) add("I10");
  if (inScope && !followUp) add(c.intent === "availability" ? "I3" : "I1");

  // 5. Customer.
  add(input.customer.kind === "known" ? "C1" : isFreeDomain(input.sender.email) ? "C4" : "C2");
  if (f.card_on_file) add("C7");
  if (f.net_terms_request && !f.billing_question) add("C9");
  if (f.tax_exempt) add("C10");
  if (input.newShipTo) add("C11");

  // Follow-ups on the thread (T1–T3): all rules still apply to the merged request.
  let resend = false;
  if (t.priorAction) {
    if (c.followUp === "accept" && t.hasQuote) {
      add("T1");
      resend = true;
    } else if (c.followUp === "change") add("T3");
    else if (c.followUp !== "price_pushback") add("T2");
  }

  // 6–8. Lines, price and quantity — only for a request we'd quote.
  if (inScope) {
    let ok = 0;
    let notSellable = 0;
    input.resolved.forEach((r, i) => {
      const n = i + 1;
      const k = r.issues;
      const before = hits.length;
      if (!r.line.sku) {
        // No SKU: description matching isn't available yet, so it can't be matched (P7).
        add("P7", n);
        notSellable++;
        return;
      }
      if (r.productId == null || k.includes("line_blocked_by_assortment")) {
        add("P2", n);
        notSellable++;
        return;
      }
      if (k.includes("line_unresolved")) {
        add("P10", n);
        notSellable++;
        return;
      }
      if (r.parentSku) {
        add("P14", n);
        return;
      }
      if (k.includes("line_sku_description_conflict")) add("P7", n);
      if (k.includes("line_unpriced")) add("Q5", n);
      if (k.includes("line_inventory_short")) add("P9", n);
      if (k.includes("line_qty_bounds")) add("QB", n);
      const qty = r.line.quantity;
      if (qty == null) add("Q8", n);
      else if (qty >= cfg.unusualQuantity) add("Q7", n);
      const stated = r.line.statedUnitPrice;
      const calc = r.calculatedUnitPrice;
      if (stated != null && calc != null && stated < calc - 0.005) add("Q2", n);
      if (hits.length === before) {
        add("P1", n);
        ok++;
      }
    });
    if (ok > 0 && notSellable > 0) add("P3");

    const seen = new Map<string, number>();
    input.resolved.forEach((r, i) => {
      const sku = (r.matchedSku ?? r.line.sku ?? "").toUpperCase();
      if (!sku) return;
      if (seen.has(sku)) add("P15", i + 1);
      else seen.set(sku, i + 1);
    });

    if (input.resolved.length > cfg.maxLinesBeforeHold) add("A2");
    if (input.requestTotal > cfg.orderValueHoldUsd) add("Q6");
    if (ok > 0 && !hits.some((h) => h.id === "Q2" || h.id === "Q5")) add("Q1");
    add(input.extracted.poNumber ? "O1" : "O2");
  }

  if (f.substitute_requested) add("P11");
  if (f.modification_requested) add("P12");
  if (f.documentation_required) add("P13");
  if (f.kit_or_assembly) add("P16");
  if (f.unit_of_measure_unclear) add("Q9");
  const currency = input.extracted.currency?.toUpperCase();
  if (f.non_usd_currency || (currency && currency !== "USD")) add("Q10");
  if (f.shipping_cost_question) add("Q11");
  if (f.freight_or_expedite) add("Q12");
  if (f.mentions_attachment && !input.hasAttachments) add("A10");
  if (f.external_file_link) add("A11");
  if (f.formal_quote_requested) add("O3");
  if (f.price_hold_requested) add("O4");
  if (f.need_by_date) add("O5");
  if (f.blanket_order) add("O6");
  if (f.drop_ship) add("O7");
  if (f.change_existing_order) add("O8");
  if (f.cannot_use_checkout) add("O9X");
  else if (f.asks_to_place_order) add("O9");
  if (f.checkout_issue) add("O10");

  return finalize(input, cfg, hits, resend);
}

function strictest(hits: ScenarioHit[]): RulesAction {
  return hits.reduce<RulesAction>((a, h) => stricter(a, h.action), "AUTO_RESPOND");
}

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

function finalize(input: RulesInput, cfg: RulesConfig, hits: ScenarioHit[], resend = false): RulesOutcome {
  let action = strictest(hits);

  // The reply a HOLD holds is the one the request would otherwise get.
  const base = strictest(hits.filter((h) => h.action !== "HOLD"));

  // 11. Clarification limit (T5).
  if (action === "CLARIFY" && input.thread.clarificationRoundsUsed >= cfg.maxClarificationRounds) {
    const d = SCENARIOS.T5;
    hits.push({ id: "T5", action: d.action, code: d.code });
    action = "HOLD";
  }

  // 12. Review-all mode.
  let reviewAll = false;
  if (cfg.reviewAll && (action === "AUTO_RESPOND" || action === "CLARIFY")) {
    action = "HOLD";
    reviewAll = true;
  }

  const reasonCodes: ReasonCode[] =
    action === "HOLD" || action === "ESCALATE"
      ? uniq([
          ...hits.filter((h) => h.action === action && h.code).map((h) => h.code!),
          ...(reviewAll ? (["review_all_mode"] as ReasonCode[]) : []),
        ])
      : [];

  let replyKind: ReplyKind;
  switch (action) {
    case "NO_RESPONSE":
      replyKind = "none";
      break;
    case "ESCALATE":
      replyKind = cfg.escalationAcknowledgment ? "ack" : "none";
      break;
    case "CLARIFY":
      replyKind = "clarify";
      break;
    case "AUTO_RESPOND":
      replyKind = resend ? "resend_link" : "quote";
      break;
    case "HOLD":
      replyKind = base === "CLARIFY" || hits.some((h) => h.id === "T5") ? "clarify" : resend ? "resend_link" : "quote";
      break;
  }

  const lineStatuses: RulesLineStatus[] = [];
  const lineScenarios: string[] = [];
  input.resolved.forEach((_r, i) => {
    const mine = hits.filter((h) => h.line === i + 1);
    const top = mine.reduce<ScenarioHit | null>((a, h) => (!a || stricter(a.action, h.action) !== a.action ? h : a), null);
    lineStatuses.push(top ? STATUS[top.action] : "ok");
    lineScenarios.push(top?.id ?? "P1");
  });

  return {
    action,
    scenarios: hits,
    reasonCodes,
    lineStatuses,
    lineScenarios,
    replyKind,
    notesForRep:
      notesFor(action, reasonCodes, input, hits) +
      (hits.some((h) => h.id === "I13") && action === "HOLD"
        ? ` The customer wrote in "${input.classification.language}"; the draft is in English, so translate it before sending.`
        : ""),
  };
}
