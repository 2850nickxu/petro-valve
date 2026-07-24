import { tryGetStoreContext } from "@/lib/bc/store-context";
import { redisConfigured } from "@/lib/redis";
import { getPoAgentConfig } from "./config";
import { hasConfiguredModel } from "./ai/registry";
import { googleCredsFromEnv } from "./channel/google-auth";
import { msCredsFromEnv } from "./channel/microsoft";
import { staffSecret } from "./staff-auth";

// Env-derived admin/health status (no network) for the dashboard + settings pages.

type Env = Record<string, string | undefined>;

export interface AdminStatus {
  enabled: boolean;
  mode: string;
  channel: string;
  mailbox?: string;
  store: { configured: boolean; storeHash?: string; channelId?: number };
  redis: boolean;
  ai: { configured: boolean; model?: string };
  channelCreds: { google: boolean; microsoft: boolean };
  escalation: { email: boolean; slack: boolean };
  staffGate: boolean;
  paymentCodes: string[];
  limits: {
    maxClarifications: number;
    priceTolerancePct: number;
    escalateValue: number;
    reminderDays: number;
    sessionExpiryDays: number;
    firstOrderConfirm: boolean;
    dailySubmitCap?: number;
  };
}

export function adminStatus(env: Env = process.env): AdminStatus {
  const config = getPoAgentConfig(env);
  const ctx = tryGetStoreContext(env);
  return {
    enabled: config.enabled,
    mode: config.mode,
    channel: config.channel,
    mailbox: env.PO_AGENT_MAILBOX ?? env.GOOGLE_PO_MAILBOX ?? env.MS_PO_MAILBOX ?? undefined,
    store: { configured: Boolean(ctx), storeHash: ctx?.storeHash, channelId: ctx?.channelId },
    redis: redisConfigured(env),
    ai: { configured: hasConfiguredModel(env), model: config.model },
    channelCreds: {
      google: Boolean(googleCredsFromEnv(env)),
      microsoft: Boolean(msCredsFromEnv(env)),
    },
    escalation: { email: Boolean(config.escalationEmail), slack: Boolean(config.slackWebhookUrl) },
    staffGate: Boolean(staffSecret(env)),
    paymentCodes: config.poPaymentCodes,
    limits: {
      maxClarifications: config.maxClarifications,
      priceTolerancePct: config.priceTolerancePct,
      escalateValue: config.escalateValue,
      reminderDays: config.reminderDays,
      sessionExpiryDays: config.sessionExpiryDays,
      firstOrderConfirm: config.firstOrderConfirm,
      dailySubmitCap: config.dailySubmitCap,
    },
  };
}

/** True when everything required to actually process live email is present. */
export function isOperational(s: AdminStatus): boolean {
  return s.enabled && s.store.configured && s.redis && (s.channelCreds.google || s.channelCreds.microsoft);
}
