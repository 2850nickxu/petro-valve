// Rules configuration (doc §5). Launch defaults live here; the "Decision rules (draft)"
// settings group overrides them at runtime. `reviewAll` comes from the caller — the
// simulator has its own per-conversation toggle.
//
// The doc's `escalation_acknowledgment` (§6.4) is deliberately not implemented: an
// escalation sends the customer nothing and a sales agent replies (owner decision,
// 2026-10-14).

type Env = Record<string, string | undefined>;

export interface RulesConfig {
  /** Every AUTO_RESPOND / CLARIFY becomes HOLD (the doc's hypercare default is on). */
  reviewAll: boolean;
  /** Below this intent confidence (0–1), escalate (I10). */
  intentConfidenceMin: number;
  /** Request total above this is held (Q6). */
  orderValueHoldUsd: number;
  /** More lines than this is held (A2). */
  maxLinesBeforeHold: number;
  /** Clarification rounds before the next one becomes a HOLD (T5). */
  maxClarificationRounds: number;
  /** A line quantity at or above this is held (Q7). The doc's "~50x the customer's norm"
   * needs order history, which the agent doesn't read yet. */
  unusualQuantity: number;
  /** Sender domains that are Petro Valve staff (I11). */
  staffDomains: string[];
  /** Model attempts before a model error escalates (T15). */
  modelRetryAttempts: number;
  /** Days a quote stays valid. */
  quoteExpiryDays: number;
}

export const RULES_DEFAULTS: RulesConfig = {
  reviewAll: true,
  intentConfidenceMin: 0.9,
  orderValueHoldUsd: 50000,
  maxLinesBeforeHold: 50,
  maxClarificationRounds: 1,
  unusualQuantity: 10000,
  staffDomains: ["petrovalve.com"],
  modelRetryAttempts: 3,
  quoteExpiryDays: 30,
};

function num(v: string | undefined, def: number): number {
  if (v == null || v === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function domains(v: string | undefined, def: string[]): string[] {
  if (v == null || v === "") return def;
  return v
    .split(",")
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
}

export function getRulesConfig(env: Env = process.env, over: Partial<RulesConfig> = {}): RulesConfig {
  return {
    reviewAll: RULES_DEFAULTS.reviewAll,
    intentConfidenceMin: num(env.PO_AGENT_RULES_INTENT_MIN, RULES_DEFAULTS.intentConfidenceMin),
    orderValueHoldUsd: num(env.PO_AGENT_RULES_HOLD_USD, RULES_DEFAULTS.orderValueHoldUsd),
    maxLinesBeforeHold: num(env.PO_AGENT_RULES_MAX_LINES, RULES_DEFAULTS.maxLinesBeforeHold),
    maxClarificationRounds: num(env.PO_AGENT_RULES_MAX_CLARIFY, RULES_DEFAULTS.maxClarificationRounds),
    unusualQuantity: num(env.PO_AGENT_RULES_UNUSUAL_QTY, RULES_DEFAULTS.unusualQuantity),
    staffDomains: domains(env.PO_AGENT_RULES_STAFF_DOMAINS, RULES_DEFAULTS.staffDomains),
    modelRetryAttempts: Math.max(1, num(env.PO_AGENT_RULES_MODEL_RETRIES, RULES_DEFAULTS.modelRetryAttempts)),
    quoteExpiryDays: RULES_DEFAULTS.quoteExpiryDays,
    ...over,
  };
}
