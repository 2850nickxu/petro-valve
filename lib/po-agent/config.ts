// Central env parsing + feature flag for the PO agent. Everything is read at call time
// (env passed in) so tests are deterministic and the flag can flip without a rebuild.
// Feature OFF by default: when PO_AGENT_ENABLED !== "true" the agent is fully inert.

import type { Channel } from "./types";

type Env = Record<string, string | undefined>;

function bool(v: string | undefined, def = false): boolean {
  if (v == null || v === "") return def;
  const s = v.toLowerCase();
  return s === "true" || s === "1" || s === "yes";
}
function num(v: string | undefined, def: number): number {
  if (v == null || v === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}
function optNum(v: string | undefined): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
function csv(v: string | undefined): string[] {
  if (!v) return [];
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}
function jsonObj<T>(v: string | undefined, def: T): T {
  if (!v) return def;
  try {
    return JSON.parse(v) as T;
  } catch {
    return def;
  }
}

export type PoAgentMode = "auto" | "review";
/** The commerce platform this deployment sells through (lib/commerce picks the adapter). */
export type CommercePlatform = "bigcommerce" | "magento";
export type QuoteEmailMode = "own" | "native";

export interface PoAgentConfig {
  enabled: boolean;
  /** PO_AGENT_COMMERCE; BigCommerce unless set to "magento". */
  commerce: CommercePlatform;
  mode: PoAgentMode;
  channel: Channel;
  model?: string;
  maxClarifications: number;
  maxRepliesPerThread: number;
  priceTolerancePct: number;
  escalateValue: number;
  /** Store's enabled pay-on-account payment code(s). Falls back to a sensible list. */
  poPaymentCodes: string[];
  quoteEmail: QuoteEmailMode;
  reminderDays: number;
  sessionExpiryDays: number;
  firstOrderConfirm: boolean;
  sessionTokenBudget?: number;
  dailySubmitCap?: number;
  simulatorSend: boolean;
  /** When sandbox mode submits, also send buyer emails (else suppress + capture). */
  simulatorSendEmails: boolean;
  /** Forward below-contract POs to the company's sales rep + admin on escalation. */
  forwardPriceMismatch: boolean;
  escalationEmail?: string;
  slackWebhookUrl?: string;
  /** MSF mailbox → channelId map. Empty ⇒ resolve via user channelList then fallback. */
  channelMap: Record<string, number>;
  storefrontMcpUrl?: string;
  allowDomainFallback: boolean;
  inboundSecret?: string;
}

const DEFAULT_PO_PAYMENT_CODES = ["purchase_order", "cheque", "terms"];

export function getPoAgentConfig(env: Env = process.env): PoAgentConfig {
  const codes = csv(env.PO_AGENT_PO_PAYMENT_CODES);
  return {
    enabled: bool(env.PO_AGENT_ENABLED, false),
    commerce: env.PO_AGENT_COMMERCE?.trim().toLowerCase() === "magento" ? "magento" : "bigcommerce",
    mode: env.PO_AGENT_MODE === "review" ? "review" : "auto",
    channel: env.PO_AGENT_CHANNEL === "microsoft" ? "microsoft" : "google",
    model: env.PO_AGENT_MODEL || undefined,
    maxClarifications: num(env.PO_AGENT_MAX_CLARIFICATIONS, 2),
    maxRepliesPerThread: num(env.PO_AGENT_MAX_REPLIES_PER_THREAD, 6),
    priceTolerancePct: num(env.PO_AGENT_PRICE_TOLERANCE_PCT, 1),
    escalateValue: num(env.PO_AGENT_ESCALATE_VALUE, 25000),
    poPaymentCodes: codes.length ? codes : DEFAULT_PO_PAYMENT_CODES,
    quoteEmail: env.PO_AGENT_QUOTE_EMAIL === "native" ? "native" : "own",
    reminderDays: num(env.PO_AGENT_REMINDER_DAYS, 3),
    sessionExpiryDays: num(env.PO_AGENT_SESSION_EXPIRY_DAYS, 10),
    firstOrderConfirm: bool(env.PO_AGENT_FIRST_ORDER_CONFIRM, true),
    sessionTokenBudget: optNum(env.PO_AGENT_SESSION_TOKEN_BUDGET),
    dailySubmitCap: optNum(env.PO_AGENT_DAILY_SUBMIT_CAP),
    simulatorSend: bool(env.PO_AGENT_SIMULATOR_SEND, false),
    simulatorSendEmails: bool(env.PO_AGENT_SIMULATOR_SEND_EMAILS, false),
    forwardPriceMismatch: bool(env.PO_AGENT_FORWARD_PRICE_MISMATCH, false),
    escalationEmail: env.PO_AGENT_ESCALATION_EMAIL || undefined,
    slackWebhookUrl: env.PO_AGENT_SLACK_WEBHOOK_URL || undefined,
    channelMap: jsonObj<Record<string, number>>(env.PO_AGENT_CHANNEL_MAP, {}),
    storefrontMcpUrl: env.BIGCOMMERCE_STOREFRONT_MCP_URL || undefined,
    allowDomainFallback: bool(env.PO_AGENT_ALLOW_DOMAIN_FALLBACK, false),
    inboundSecret: env.PO_AGENT_INBOUND_SECRET || undefined,
  };
}

/** Quick, allocation-light check used by route guards. */
export function poAgentEnabled(env: Env = process.env): boolean {
  return bool(env.PO_AGENT_ENABLED, false);
}
