import type { PoAgentConfig } from "./config";
import type { IdentifyResult } from "./core/identify";
import { ISSUE_CATEGORY } from "./core/decide";
import { submittableLines } from "./core/resolve";
import { money } from "./ai/respond";
import { actorLabel } from "./people";
import { REASON_TEXT, scenarioLabel } from "./rules/catalog";
import type { RulesConfig } from "./rules/config";
import type { Classification, RulesAction, RulesOutcome } from "./rules/types";
import type {
  AuditEntry,
  Decision,
  DecisionStage,
  ExtractedPo,
  ResolvedLine,
  SessionMessage,
  SourceRef,
  StepOutcome,
  StepSetting,
  ValidationIssue,
  ValidationIssueKind,
} from "./types";

// Decision steps: the audit events that drive the session's decision trail. Every
// `summary` here is a code template over structured data the pipeline already validated —
// the model never writes one. Numbers are interpolated from the store's answers, and
// per-line detail is copied onto the step because `session.resolution` is overwritten on
// the next run. Builders are pure, so the wording is unit-tested directly.

/** An audit entry before it's timestamped. Every step carries a summary. */
export type DecisionStep = Omit<AuditEntry, "at" | "summary"> & { summary: string };

/** What `evaluate()` checked beyond the lines — the inputs to validate and decide. */
export interface EvaluateChecks {
  payOnAccount: { valid: boolean; reasons: ValidationIssueKind[]; methodAvailable: boolean; creditEnabled: boolean };
  availableCredit: number | null;
  canOrder: boolean;
  quoteEnabled: boolean;
  hasShipTo: boolean;
  multiCurrency: boolean;
  currency: string | null;
  estimatedTotal: number;
}

const RAW_CAP = 120;
/** Upper bound on per-line entries kept on one step, so a huge PO can't bloat the session. */
const LINE_CAP = 200;

// ── Formatting ───────────────────────────────────────────────────────────────

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function clip(s: string, n = RAW_CAP): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "A", "A and B", "A, B and C". */
function joinAnd(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** Line numbers as prose: "line 2", "lines 1 and 3", "lines 1–4 and 6". */
export function lineList(nums: number[]): string {
  const sorted = [...new Set(nums)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    if (j - i >= 2) parts.push(`${sorted[i]}–${sorted[j]}`);
    else for (let k = i; k <= j; k++) parts.push(String(sorted[k]));
    i = j + 1;
  }
  const single = parts.length === 1 && !parts[0].includes("–");
  return `${single ? "line" : "lines"} ${joinAnd(parts)}`;
}

/** Signed percentage with a true minus sign: "−10.9%", "+3.0%". */
function signedPct(n: number): string {
  const r = Math.round(n * 10) / 10;
  if (r === 0) return "0.0%";
  return `${r < 0 ? "−" : "+"}${Math.abs(r).toFixed(1)}%`;
}

function who(actor: string | undefined): string {
  return actorLabel(actor);
}

function messageRef(m: Pick<SessionMessage, "id" | "at">, label = "Message"): SourceRef {
  return { system: "email", type: "message", id: m.id, label: `${label} ${m.id}`, readAt: m.at };
}

// ── Reason phrases ───────────────────────────────────────────────────────────

/** Short, staff-facing phrases for issue kinds and decision reasons. */
const REASON: Record<string, string> = {
  unknown_sender: "sender not matched to a store account",
  company_not_approved: "company not approved",
  channel_ambiguous: "storefront unclear",
  channel_access_denied: "buyer can't purchase on this storefront",
  line_unresolved: "no product match",
  line_parent_sku: "parent SKU needs a version",
  line_blocked_by_assortment: "not in the company's assortment",
  line_qty_bounds: "quantity outside order limits",
  line_inventory_short: "not enough stock",
  line_sku_description_conflict: "SKU and description disagree",
  line_unpriced: "no store price",
  price_mismatch: "PO price outside tolerance",
  missing_quantity: "missing quantity",
  missing_ship_to: "no ship-to address",
  payment_method_unavailable: "no pay-on-account payment method",
  credit_exceeded: "over available credit",
  credit_hold: "account on credit hold",
  quote_feature_disabled: "quotes not enabled",
  po_number_missing: "PO number missing",
  stale_thread: "new PO on a finished thread",
  multi_currency: "currency other than USD",
  daily_cap: "daily submission cap reached",
  internal_error: "internal error",
  pay_on_account: "pay on account available",
  credit_card: "buyer asked to pay by card",
  no_terms: "pay on account not available",
  buyer_role_requires_approval: "buyer's role can't place orders",
  price_review_requested: "buyer asked for sales pricing",
  clarification_exhausted: "out of clarification rounds",
};

export function reasonText(reason: string): string {
  return REASON[reason] ?? reason.replace(/[_:]+/g, " ").trim();
}

/** Line numbers carrying each issue kind, from the per-line issue lists. */
function linesByIssue(resolved: ResolvedLine[]): Map<string, number[]> {
  const map = new Map<string, number[]>();
  resolved.forEach((r, i) => {
    for (const kind of r.issues) map.set(kind, [...(map.get(kind) ?? []), i + 1]);
  });
  return map;
}

function reasonWithLines(reason: string, byIssue: Map<string, number[]>): string {
  const lines = byIssue.get(reason);
  return lines?.length ? `${reasonText(reason)} (${lineList(lines)})` : reasonText(reason);
}

// ── Settings ─────────────────────────────────────────────────────────────────

function setting(key: keyof PoAgentConfig, label: string, value: string): StepSetting {
  return { key, label, value };
}

export const priceToleranceSetting = (config: Pick<PoAgentConfig, "priceTolerancePct">) =>
  setting("priceTolerancePct", "Price tolerance", `${config.priceTolerancePct}%`);
const maxClarificationsSetting = (config: Pick<PoAgentConfig, "maxClarifications">) =>
  setting("maxClarifications", "Max clarifications", String(config.maxClarifications));

// ── Run start ────────────────────────────────────────────────────────────────

export function receivedStep(msg: SessionMessage): DecisionStep {
  const files = (msg.attachments ?? []).map((a) => a.filename);
  const attached = files.length ? `, with ${plural(files.length, "attachment")} (${joinAnd(files)})` : "";
  const first = (msg.run ?? 1) === 1;
  return {
    event: "received",
    stage: "received",
    summary: first
      ? `New email from ${msg.from ?? "an unknown sender"} on a new thread${attached}.`
      : `${msg.from ?? "The buyer"} replied on the same thread${attached}.`,
    sources: [
      messageRef(msg, first ? "Original email" : "Reply"),
      ...files.map((f): SourceRef => ({ system: "email", type: "attachment", id: msg.id, label: f })),
    ],
    detail: { messageId: msg.id, from: msg.from, subject: msg.subject, newThread: first, attachments: files },
  };
}

export function reopenedStep(): DecisionStep {
  return {
    event: "reopened",
    stage: "lifecycle",
    summary: "The buyer wrote back after the session expired, so it was reopened.",
  };
}

// ── Identify / extract ───────────────────────────────────────────────────────

export function identifiedStep(idres: IdentifyResult, from: string): DecisionStep {
  const b = idres.buyer;
  if (!b) {
    return {
      event: "identified",
      stage: "identify",
      outcome: "unknown_sender",
      summary: `No store account matches ${from}.`,
      detail: { found: false, companyApproved: false, email: from },
    };
  }
  const company = b.companyName || `company #${b.companyId}`;
  return {
    event: "identified",
    stage: "identify",
    outcome: idres.companyApproved ? "known_account" : "flagged",
    summary: `Sender ${b.email} matched ${company}. ${idres.companyApproved ? "Company approved." : "The company isn't approved yet."}`,
    sources: [
      { system: "bigcommerce", type: "company", id: String(b.companyId), label: `Company #${b.companyId}`, value: b.companyName },
      { system: "bigcommerce", type: "customer", id: String(b.customerId), label: `Customer #${b.customerId}`, value: b.email },
    ],
    detail: {
      found: true,
      companyApproved: idres.companyApproved,
      email: b.email,
      companyId: b.companyId,
      companyName: b.companyName,
      customerId: b.customerId,
      b2bUserId: b.b2bUserId,
      role: b.role,
    },
  };
}

const PAYMENT_TEXT: Record<ExtractedPo["paymentIntent"], string> = {
  on_account: "pay on account",
  credit_card: "pay by card",
  unspecified: "payment not stated",
};

export function extractedStep(extracted: ExtractedPo, msg: Pick<SessionMessage, "id" | "at">, reread: boolean): DecisionStep {
  const po = extracted.poNumber ? `PO ${extracted.poNumber}` : "No PO number";
  const n = extracted.lines.length;
  return {
    event: "extracted",
    stage: "extract",
    outcome: `confidence_${extracted.confidence}` as StepOutcome,
    summary:
      `${reread ? "Re-read the PO with the buyer's reply. " : ""}${po}, ${PAYMENT_TEXT[extracted.paymentIntent]}, ${plural(n, "line")}.` +
      (n ? " Each line keeps the exact text it was read from." : ""),
    sources: [messageRef(msg, "Email")],
    detail: {
      lines: n,
      confidence: extracted.confidence,
      paymentIntent: extracted.paymentIntent,
      poNumber: extracted.poNumber,
      currency: extracted.currency,
    },
  };
}

export function triagedStep(): DecisionStep {
  return {
    event: "triaged",
    stage: "decide",
    outcome: "rejected",
    summary: "This didn't look like a PO (no SKUs, no PO number, low confidence), so the agent sent its one-time triage reply.",
  };
}

export function priceAnswerStep(kind: "review" | "accept"): DecisionStep {
  return kind === "review"
    ? {
        event: "price_review_requested",
        stage: "price",
        outcome: "resolved_by_buyer",
        summary: "The buyer answered the price question by asking for sales to price it as a quote.",
      }
    : {
        event: "contract_price_accepted",
        stage: "price",
        outcome: "resolved_by_buyer",
        summary: "The buyer answered the price question by accepting the contract price.",
      };
}

// ── Resolve / price / validate / decide ──────────────────────────────────────

export type LineMatch = "exact_sku" | "parent_sku" | "not_found" | "no_sku" | "not_purchasable" | "not_in_assortment";

export function lineMatch(r: ResolvedLine): LineMatch {
  if (!r.line.sku) return "no_sku";
  if (r.productId == null) return "not_found";
  if (r.parentSku) return "parent_sku";
  if (r.blockedByAssortment) return "not_in_assortment";
  if (r.issues.includes("line_unresolved")) return "not_purchasable";
  return "exact_sku";
}

const MATCH_TEXT: Record<LineMatch, string> = {
  exact_sku: "matched by exact SKU",
  parent_sku: "parent SKU, version needed",
  not_found: "SKU not in the online catalog",
  no_sku: "no SKU given",
  not_purchasable: "product hidden or disabled",
  not_in_assortment: "not in the company's assortment",
};
const MATCH_ORDER: LineMatch[] = ["exact_sku", "parent_sku", "not_found", "no_sku", "not_purchasable", "not_in_assortment"];

export function resolvedStep(resolved: ResolvedLine[]): DecisionStep {
  const submittable = submittableLines(resolved).length;
  const total = resolved.length;
  const matches = resolved.map(lineMatch);
  const groups = MATCH_ORDER.map((m) => ({ m, lines: matches.flatMap((x, i) => (x === m ? [i + 1] : [])) })).filter((g) => g.lines.length);
  const head =
    total === 1
      ? `The line ${submittable ? "can" : "can't"} be ordered.`
      : `${submittable} of ${plural(total, "line")} can be ordered.`;
  const summary = total
    ? [head, ...groups.map((g) => `${cap(MATCH_TEXT[g.m])}: ${lineList(g.lines)}.`)].join(" ")
    : "The PO had no lines to match.";

  return {
    event: "resolved",
    stage: "resolve",
    outcome: total > 0 && submittable === total && matches.every((m) => m === "exact_sku") ? "ok" : "flagged",
    summary,
    sources: resolved.slice(0, LINE_CAP).flatMap((r): SourceRef[] =>
      r.productId != null
        ? [{ system: "bigcommerce", type: "product", id: String(r.productId), label: `Product · ${r.matchedSku ?? r.line.sku}`, value: r.productName }]
        : [],
    ),
    detail: {
      submittable,
      total,
      lines: resolved.slice(0, LINE_CAP).map((r, i) => ({
        line: i + 1,
        rawText: clip(r.line.rawText),
        sku: r.line.sku,
        quantity: r.line.quantity,
        match: matches[i],
        productId: r.productId,
        variantId: r.variantId,
        productName: r.productName,
        ...(r.parentSku ? { versions: r.variantChoiceCount ?? r.variantChoices?.length ?? 0 } : {}),
        issues: r.issues,
      })),
      ...(total > LINE_CAP ? { linesOmitted: total - LINE_CAP } : {}),
    },
  };
}

/** How many out-of-tolerance lines get their own sentence before the rest are counted. */
const PRICE_SENTENCES = 3;

export function pricedStep(
  resolved: ResolvedLine[],
  config: Pick<PoAgentConfig, "priceTolerancePct">,
  readAt: string,
): DecisionStep {
  const lines = resolved.slice(0, LINE_CAP).map((r, i) => ({ r, line: i + 1, sku: r.matchedSku ?? r.line.sku ?? undefined }));
  // A parent-SKU line has no single price yet: each version is priced instead.
  const parents = lines
    .filter(({ r }) => r.productId != null && r.parentSku)
    .map(({ r, line, sku }) => ({ line, sku, versions: (r.variantChoices ?? []).map((c) => ({ sku: c.sku, store: c.unitPrice })) }));
  const priced = lines
    .filter(({ r }) => r.productId != null && !r.parentSku)
    .map(({ r, line, sku }) => {
      const stated = r.line.statedUnitPrice;
      const store = r.calculatedUnitPrice;
      const diffPct = stated != null && store != null && store > 0 ? Math.round(((stated - store) / store) * 1000) / 10 : undefined;
      // Tolerance is decided by priceLines (the price_mismatch flag), not recomputed here.
      return { line, sku, productId: r.productId!, variantId: r.variantId, stated, store, diffPct, withinTolerance: !r.issues.includes("price_mismatch") };
    });

  const flagged = priced.filter((p) => !p.withinTolerance);
  const within = priced.filter((p) => p.withinTolerance && p.stated != null && p.store != null);
  const noPoPrice = priced.filter((p) => p.stated == null && p.store != null);
  const unpriced = priced.filter((p) => p.store == null);
  const nums = (xs: Array<{ line: number }>) => cap(lineList(xs.map((x) => x.line)));

  const parts: string[] = [];
  for (const p of flagged.slice(0, PRICE_SENTENCES)) {
    parts.push(
      `Line ${p.line}: PO ${money(p.stated!)} vs store ${money(p.store!)} (${signedPct(p.diffPct ?? 0)}), outside the ${config.priceTolerancePct}% price tolerance.`,
    );
  }
  if (flagged.length > PRICE_SENTENCES) parts.push(`${plural(flagged.length - PRICE_SENTENCES, "more line")} outside tolerance.`);
  if (within.length) parts.push(`${nums(within)} ${within.length === 1 ? "is" : "are"} within tolerance.`);
  if (noPoPrice.length) parts.push(`${nums(noPoPrice)}: no PO price, so the store price applies.`);
  if (parents.length) parts.push(`${nums(parents)}: priced per version until the buyer picks one.`);
  if (unpriced.length) parts.push(`${nums(unpriced)}: the store returned no price.`);

  return {
    event: "priced",
    stage: "price",
    outcome: flagged.length || unpriced.length ? "flagged" : "ok",
    setting: priceToleranceSetting(config),
    summary: parts.length ? parts.join(" ") : "No matched lines to price.",
    sources: priced.flatMap((p): SourceRef[] =>
      p.store != null
        ? [{ system: "bigcommerce", type: "price", id: `${p.productId}:${p.variantId ?? ""}`, label: `Store price · ${p.sku}`, value: p.store, readAt }]
        : [],
    ),
    detail: { tolerancePct: config.priceTolerancePct, readAt, lines: [...priced, ...parents].sort((a, b) => a.line - b.line) },
  };
}

/** Line-level kinds the validate step explains itself (resolve and price cover the rest). */
const VALIDATE_LINE_KINDS: ValidationIssueKind[] = ["line_inventory_short", "line_qty_bounds", "missing_quantity"];

export function validatedStep(issues: ValidationIssue[], resolved: ResolvedLine[], checks: EvaluateChecks): DecisionStep {
  const parts: string[] = [];

  // SKU/description conflicts lead, with both sides quoted — they're the check most
  // likely to change what gets shipped.
  const conflicts: string[] = [];
  const sources: SourceRef[] = [];
  resolved.forEach((r, i) => {
    if (!r.issues.includes("line_sku_description_conflict")) return;
    conflicts.push(
      `Line ${i + 1}: SKU ${r.matchedSku} is "${clip(r.productName ?? "", 60)}", but the buyer wrote "${clip(r.line.description ?? "", 60)}"${r.descriptionConflict ? ` (${r.descriptionConflict})` : ""}.`,
    );
    if (r.productId != null) {
      sources.push({ system: "bigcommerce", type: "product", id: String(r.productId), label: `Product · ${r.matchedSku}`, value: r.productName });
    }
  });
  if (conflicts.length > 3) conflicts.splice(3, conflicts.length - 3, `${plural(conflicts.length - 3, "more SKU/description conflict")}.`);
  parts.push(...conflicts);

  resolved.forEach((r, i) => {
    const n = i + 1;
    if (r.issues.includes("line_inventory_short")) {
      parts.push(`Line ${n}: ${r.line.quantity} ordered, ${r.inventoryLevel ?? 0} in stock.`);
    }
    if (r.issues.includes("line_qty_bounds")) {
      const limits = [r.minQty ? `at least ${r.minQty}` : "", r.maxQty ? `at most ${r.maxQty}` : ""].filter(Boolean).join(", ");
      parts.push(`Line ${n}: quantity ${r.line.quantity} is outside the order limits (${limits}).`);
    }
    if (r.issues.includes("missing_quantity")) parts.push(`Line ${n}: no quantity.`);
  });
  if (parts.length > 3) parts.splice(3, parts.length - 3, `${plural(parts.length - 3, "more line issue")}.`);

  const stockOk = resolved.flatMap((r, i) =>
    r.productId != null && !r.parentSku && !r.issues.some((k) => VALIDATE_LINE_KINDS.includes(k)) ? [i + 1] : [],
  );
  if (stockOk.length) parts.push(`Stock and order limits are fine on ${lineList(stockOk)}.`);

  const kinds = new Set(issues.map((i) => i.kind));
  const account: string[] = [];
  if (kinds.has("company_not_approved")) account.push("the company isn't approved");
  if (kinds.has("channel_access_denied")) account.push("the buyer can't purchase on this storefront");
  if (kinds.has("channel_ambiguous")) account.push("the buyer's account is on more than one storefront");
  if (!checks.hasShipTo) account.push("there's no ship-to address");
  if (checks.multiCurrency) account.push(`the PO is in ${checks.currency}, which can't be processed automatically`);
  if (kinds.has("po_number_missing")) account.push("the PO number is missing");
  if (account.length) parts.push(`${cap(joinAnd(account))}.`);

  const pay = checks.payOnAccount;
  if (pay.valid) {
    parts.push(
      `Pay on account is available${checks.availableCredit != null ? ` (estimated ${money(checks.estimatedTotal)}, ${money(checks.availableCredit)} credit available)` : ""}.`,
    );
  } else {
    const why = pay.reasons.map(reasonText);
    if (!pay.creditEnabled && !why.length) why.push("the company's credit feature is off");
    parts.push(`Pay on account isn't available${why.length ? `: ${joinAnd(why)}` : ""}.`);
  }
  if (!checks.canOrder) parts.push("The buyer's role can't place orders.");
  if (!checks.quoteEnabled) parts.push("Quotes aren't enabled.");

  const blocking = issues.filter((i) => i.blocking);
  const byIssue = linesByIssue(resolved);
  const blockingKinds = [...new Set(blocking.map((i) => i.kind))];
  if (blockingKinds.length) parts.push(`Blocking: ${joinAnd(blockingKinds.map((k) => reasonWithLines(k, byIssue)))}.`);
  return {
    event: "validated",
    stage: "validate",
    outcome: blocking.length ? "flagged" : "ok",
    summary: parts.join(" "),
    ...(sources.length ? { sources: sources.slice(0, LINE_CAP) } : {}),
    detail: {
      blocking: blocking.length,
      issues: issues.map((i) => ({
        kind: i.kind,
        category: ISSUE_CATEGORY[i.kind],
        blocking: i.blocking,
        ...(i.lineRef ? { lineRef: clip(i.lineRef, 60) } : {}),
      })),
      lines: resolved.slice(0, LINE_CAP).map((r, i) => ({
        line: i + 1,
        quantity: r.line.quantity,
        inventoryTracked: r.inventoryTracked,
        inventoryLevel: r.inventoryLevel,
        minQty: r.minQty,
        maxQty: r.maxQty,
        issues: r.issues,
        ...(r.descriptionConflict ? { descriptionConflict: r.descriptionConflict } : {}),
      })),
      checks,
    },
  };
}

export function decidedStep(
  decision: Decision,
  resolved: ResolvedLine[],
  config: Pick<PoAgentConfig, "maxClarifications">,
  clarificationRounds: number,
): DecisionStep {
  const byIssue = linesByIssue(resolved);
  const reasons = decision.reasons.map((r) => reasonWithLines(r, byIssue));
  const base = { event: "decided", stage: "decide" as DecisionStage, detail: { kind: decision.kind, reasons: decision.reasons } };

  switch (decision.kind) {
    case "order":
      return { ...base, outcome: "order", summary: "Place the order on account: nothing is blocking and pay on account is available." };
    case "quote": {
      const why = decision.reasons.filter((r) => r !== "quote");
      return { ...base, outcome: "quote", summary: why.length ? `Send a quote: ${joinAnd(why.map((r) => reasonWithLines(r, byIssue)))}.` : "Send a quote." };
    }
    case "clarify": {
      const round = clarificationRounds + 1;
      return {
        ...base,
        outcome: "clarify",
        setting: maxClarificationsSetting(config),
        summary: `Ask the buyer first: ${joinAnd(reasons)}. Round ${round} of ${config.maxClarifications}.`,
        detail: { ...base.detail, round },
      };
    }
    case "escalate": {
      const exhausted = decision.reasons.includes("clarification_exhausted");
      return {
        ...base,
        outcome: "needs_review",
        ...(exhausted ? { setting: maxClarificationsSetting(config) } : {}),
        summary:
          `Hold for a person: ${joinAnd(reasons)}.` +
          (exhausted ? ` The buyer has already had ${plural(config.maxClarifications, "round")} of questions.` : ""),
      };
    }
    case "reject":
      return { ...base, outcome: "rejected", summary: `Reject: ${joinAnd(reasons)}.` };
  }
}

/** The resolve → price → validate → decide steps for one evaluation (pipeline and reprocess). */
export function evaluationSteps(
  result: { resolved: ResolvedLine[]; issues: ValidationIssue[]; decision: Decision; checks: EvaluateChecks },
  config: Pick<PoAgentConfig, "priceTolerancePct" | "maxClarifications">,
  opts: { clarificationRounds: number; readAt: string },
): DecisionStep[] {
  return [
    resolvedStep(result.resolved),
    pricedStep(result.resolved, config, opts.readAt),
    validatedStep(result.issues, result.resolved, result.checks),
    decidedStep(result.decision, result.resolved, config, opts.clarificationRounds),
  ];
}

// ── Acting on the decision ───────────────────────────────────────────────────

export type SubmitOutcome =
  | { kind: "order"; ok: true; orderId: number; grandTotal: number; statusWarning?: string }
  | { kind: "quote"; ok: true; quoteId: number; quoteNumber?: string; checkoutUrl?: string }
  | { kind: "order" | "quote"; ok: false; reason: string };

export function submittedStep(res: SubmitOutcome): DecisionStep {
  if (!res.ok) {
    return {
      event: "submitted",
      stage: "decide",
      outcome: "failed",
      summary: `Couldn't create the ${res.kind}: ${reasonText(res.reason)}. Held for a person.`,
      detail: { kind: res.kind, ok: false, reason: res.reason },
    };
  }
  if (res.kind === "order") {
    return {
      event: "submitted",
      stage: "decide",
      outcome: "order",
      summary:
        `Placed order #${res.orderId} on account, total ${money(res.grandTotal)}.` +
        (res.statusWarning ? " It couldn't be marked Awaiting Fulfillment / Pay on Account, so check it in BigCommerce." : ""),
      sources: [{ system: "bigcommerce", type: "order", id: String(res.orderId), label: `Order #${res.orderId}`, value: res.grandTotal }],
      detail: { kind: "order", ok: true, orderId: res.orderId, grandTotal: res.grandTotal, ...(res.statusWarning ? { statusWarning: res.statusWarning } : {}) },
    };
  }
  const label = res.quoteNumber ?? String(res.quoteId);
  return {
    event: "submitted",
    stage: "decide",
    outcome: "quote",
    summary: `Created quote ${label}${res.checkoutUrl ? " with a checkout link" : ""}.`,
    sources: [{ system: "bigcommerce", type: "quote", id: String(res.quoteId), label: `Quote ${label}` }],
    detail: { kind: "quote", ok: true, quoteId: res.quoteId, quoteNumber: res.quoteNumber },
  };
}

export function heldStep(
  gate: "daily_cap" | "first_order_confirm",
  config: Pick<PoAgentConfig, "dailySubmitCap" | "firstOrderConfirm">,
): DecisionStep {
  if (gate === "daily_cap") {
    return {
      event: "held",
      stage: "decide",
      outcome: "needs_review",
      setting: setting("dailySubmitCap", "Daily submit cap", String(config.dailySubmitCap)),
      summary: `Today's automatic submissions reached the daily cap of ${config.dailySubmitCap}, so this is held for a person.`,
      detail: { gate },
    };
  }
  return {
    event: "held",
    stage: "decide",
    outcome: "clarify",
    setting: setting("firstOrderConfirm", "First-order confirmation", "On"),
    summary: "This is the buyer's first order through the agent, so it asks them to confirm before placing it.",
    detail: { gate },
  };
}

const PURPOSE_TEXT: Record<NonNullable<SessionMessage["purpose"]>, string> = {
  rejection: "the rejection",
  triage: "the triage reply",
  clarification: "the clarifying question",
  escalation_notice: "the note that a person will follow up",
  first_order_confirm: "the first-order confirmation request",
  order_confirmation: "the order confirmation",
  quote_confirmation: "the quote",
  checkout_link_resend: "the checkout link again",
};

function sendWhat(msg: SessionMessage): string {
  if (msg.kind === "escalation_email") return `the escalation email to ${msg.to}`;
  if (msg.kind === "below_contract_forward") return `the original PO to ${msg.to}`;
  return msg.purpose ? PURPOSE_TEXT[msg.purpose] : "a reply";
}

/** One step per email the pipeline sent (or tried to), linked to the message log. */
export function outboundStep(msg: SessionMessage): DecisionStep {
  const what = sendWhat(msg);
  const failed = msg.status === "failed";
  const verb = msg.kind === "below_contract_forward" ? "Forwarded" : "Sent";
  const where = msg.audience === "buyer" ? " on the same email thread" : "";
  return {
    event: "outbound",
    stage: "outbound",
    outcome: failed ? "failed" : "sent",
    summary: failed
      ? `Couldn't send ${what}; the send failed.`
      : `${verb} ${what}${where}${msg.status === "captured" ? " (simulator: captured, not delivered)" : ""}.`,
    sources: [messageRef(msg)],
    detail: { messageId: msg.id, kind: msg.kind, purpose: msg.purpose, audience: msg.audience, status: msg.status, to: msg.to },
  };
}

export function forwardedStep(to: string[]): DecisionStep {
  return {
    event: "forwarded_below_contract",
    stage: "outbound",
    outcome: "sent",
    setting: setting("forwardPriceMismatch", "Forward below-contract POs", "On"),
    summary: `Forwarded the original PO to ${plural(to.length, "person", "people")} because a PO price is below contract.`,
    detail: { to: to.length },
  };
}

export function errorStep(stage: DecisionStage, message: string): DecisionStep {
  return {
    event: "error",
    stage,
    outcome: "error",
    summary: `Something went wrong during the ${stage} stage, so the session is held for a person.`,
    detail: { message, stage },
  };
}

// ── People and the reminder sweep ────────────────────────────────────────────

export function noteStep(actor: string | undefined): DecisionStep {
  return { event: "note", stage: "human", summary: `${who(actor)} added an internal note.` };
}

export function dismissedStep(actor: string | undefined): DecisionStep {
  return { event: "dismissed", stage: "human", outcome: "rejected", summary: `${who(actor)} dismissed the session.` };
}

export function forcedStep(
  actor: string | undefined,
  action: "force_order" | "force_quote",
  result: { orderId?: number; quoteId?: number; quoteNumber?: string },
): DecisionStep {
  const made =
    action === "force_order"
      ? `Order #${result.orderId} placed.`
      : `Quote ${result.quoteNumber ?? result.quoteId} created.`;
  return {
    event: `forced_${action}`,
    stage: "human",
    outcome: action === "force_order" ? "order" : "quote",
    summary: `${who(actor)} forced ${action === "force_order" ? "an order" : "a quote"}. ${made}`,
    sources:
      action === "force_order"
        ? [{ system: "bigcommerce", type: "order", id: String(result.orderId), label: `Order #${result.orderId}` }]
        : [{ system: "bigcommerce", type: "quote", id: String(result.quoteId), label: `Quote ${result.quoteNumber ?? result.quoteId}` }],
  };
}

export function repliedStep(actor: string | undefined, msg: SessionMessage): DecisionStep {
  return {
    event: "replied",
    stage: "human",
    outcome: "sent",
    summary: `${who(actor)} replied to the buyer on the same email thread.`,
    sources: [messageRef(msg)],
  };
}

export function reprocessedStep(actor: string | undefined, decision: Decision): DecisionStep {
  return {
    event: "reprocessed",
    stage: "human",
    summary: `${who(actor)} re-ran the checks against current store data. New decision: ${decision.kind}.`,
    detail: { kind: decision.kind, reasons: decision.reasons },
  };
}

export function remindedStep(config: Pick<PoAgentConfig, "reminderDays">): DecisionStep {
  return {
    event: "reminded",
    stage: "lifecycle",
    outcome: "sent",
    setting: setting("reminderDays", "Reminder after", `${config.reminderDays} days`),
    summary: `Sent the buyer one reminder after ${plural(config.reminderDays, "day")} without a reply.`,
  };
}

export function expiredStep(config: Pick<PoAgentConfig, "sessionExpiryDays">): DecisionStep {
  return {
    event: "expired",
    stage: "lifecycle",
    setting: setting("sessionExpiryDays", "Session expiry", `${config.sessionExpiryDays} days`),
    summary: `Closed after ${plural(config.sessionExpiryDays, "day")} without a reply from the buyer.`,
  };
}

// ── Decision rules (simulated conversations) ─────────────────────────────────

const INTENT_TEXT: Record<Classification["intent"], string> = {
  quote: "a quote request",
  order: "an order",
  availability: "an availability question",
  follow_up: "a reply on the thread",
  other: "something other than a quote or order",
};

const FOLLOW_UP_TEXT: Record<Classification["followUp"], string> = {
  accept: "accepting the quote",
  answer: "answering our question",
  change: "changing the request",
  price_pushback: "pushing back on price",
  none: "",
};

function flagText(key: string): string {
  return key.replace(/_/g, " ");
}

export function classifiedStep(c: Classification, msg: Pick<SessionMessage, "id" | "at">): DecisionStep {
  const flags = Object.entries(c.flags)
    .filter(([, on]) => on)
    .map(([k]) => flagText(k));
  const pct = Math.round(c.confidence * 100);
  const follow = c.followUp !== "none" ? `, ${FOLLOW_UP_TEXT[c.followUp]}` : "";
  const parts = [
    `Read as ${INTENT_TEXT[c.intent]}${follow} (${pct}% confident, ${c.source === "model" ? "model" : "keyword rules"}).`,
  ];
  if (c.language && c.language !== "en") parts.push(`Written in "${c.language}".`);
  if (flags.length) parts.push(`Signals: ${joinAnd(flags.slice(0, 8))}${flags.length > 8 ? ` and ${flags.length - 8} more` : ""}.`);
  if (c.paymentData) parts.push("Card or bank numbers were found and removed from what's stored.");
  return {
    event: "classified",
    stage: "classify",
    outcome: c.confidence >= 0.9 ? "confidence_high" : c.confidence >= 0.6 ? "confidence_medium" : "confidence_low",
    summary: parts.join(" "),
    sources: [messageRef(msg, "Email")],
    detail: { intent: c.intent, confidence: c.confidence, followUp: c.followUp, language: c.language, flags, paymentData: c.paymentData, source: c.source },
  };
}

const ACTION_OUTCOME: Record<RulesAction, StepOutcome> = {
  AUTO_RESPOND: "quote",
  CLARIFY: "clarify",
  HOLD: "held",
  ESCALATE: "needs_review",
  NO_RESPONSE: "no_response",
};

function rulesSetting(o: RulesOutcome, cfg: RulesConfig): StepSetting | undefined {
  if (o.reasonCodes.includes("review_all_mode")) return { key: "reviewAll", label: "Hold every reply for review", value: "On" };
  if (o.scenarios.some((h) => h.id === "T5")) {
    return { key: "maxClarificationRounds", label: "Max clarification rounds", value: String(cfg.maxClarificationRounds) };
  }
  if (o.scenarios.some((h) => h.id === "Q6")) return { key: "orderValueHoldUsd", label: "Hold above", value: money(cfg.orderValueHoldUsd) };
  if (o.scenarios.some((h) => h.id === "I10")) {
    return { key: "intentConfidenceMin", label: "Minimum intent confidence", value: `${Math.round(cfg.intentConfidenceMin * 100)}%` };
  }
  return undefined;
}

/** The rules' answer: the action, the scenarios behind it, and the reason codes. */
export function rulesDecidedStep(o: RulesOutcome, cfg: RulesConfig): DecisionStep {
  const ids = [...new Set(o.scenarios.map((h) => h.id))];
  const drivers = o.scenarios.filter((h) => h.action === o.action || (o.action === "HOLD" && h.id === "T5"));
  const why = [...new Set(drivers.map((h) => scenarioLabel(h.id).toLowerCase()))];
  const codes = o.reasonCodes.map((c) => REASON_TEXT[c]);
  let summary: string;
  switch (o.action) {
    case "AUTO_RESPOND":
      summary = o.replyKind === "resend_link" ? "Auto-respond: resend the checkout link." : "Auto-respond with a quote and a checkout link.";
      break;
    case "CLARIFY":
      summary = `Clarify: ${joinAnd(why)}.`;
      break;
    case "HOLD":
      summary = `Hold the reply for a person: ${joinAnd(codes)}.`;
      break;
    case "ESCALATE":
      summary = `Escalate to a person: ${joinAnd(codes)}.`;
      break;
    case "NO_RESPONSE":
      summary = `No response: ${joinAnd(why)}.`;
      break;
  }
  const setting = rulesSetting(o, cfg);
  return {
    event: "rules_decided",
    stage: "decide",
    outcome: ACTION_OUTCOME[o.action],
    summary: `${summary} Scenarios: ${ids.join(", ")}.`,
    ...(setting ? { setting } : {}),
    detail: { action: o.action, scenarios: ids, reasonCodes: o.reasonCodes, replyKind: o.replyKind },
  };
}

export function heldDraftStep(msg: SessionMessage): DecisionStep {
  return {
    event: "held_draft",
    stage: "outbound",
    outcome: "held",
    summary: `Drafted ${sendWhat(msg)} and held it for a person to approve. Nothing was sent.`,
    sources: [messageRef(msg, "Draft")],
    detail: { messageId: msg.id, purpose: msg.purpose, to: msg.to },
  };
}

export function handoffStep(lines: number, quotable: number): DecisionStep {
  return {
    event: "handoff",
    stage: "outbound",
    outcome: "needs_review",
    summary: `Escalated to a sales agent with the decision record (${quotable} of ${plural(lines, "line")} matched and priced). Nothing was sent to the customer; the sales agent replies. In the simulator this stands in for the HubSpot ticket.`,
    detail: { lines, quotable },
  };
}

export function draftApprovedStep(actor: string | undefined, msg: SessionMessage, edited: boolean): DecisionStep {
  return {
    event: "draft_approved",
    stage: "human",
    outcome: "sent",
    summary: `${who(actor)} approved the held draft${edited ? " with edits" : ""} and sent it${msg.status === "captured" ? " (simulator: captured, not delivered)" : ""}.`,
    sources: [messageRef(msg)],
  };
}
