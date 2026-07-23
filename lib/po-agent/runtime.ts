import { getRedis } from "@/lib/redis";
import { tryGetStoreContext } from "@/lib/bc/store-context";
import { getPoAgentConfig } from "./config";
import { createPoStore } from "./store";
import { resolveExtractor } from "./ai/extractor";
import { GoogleChannel } from "./channel/google";
import { googleCredsFromEnv } from "./channel/google-auth";
import type { MailSender } from "./escalate";
import type { PipelineDeps } from "./pipeline";

// Assemble real (non-dry-run) pipeline dependencies from the environment. Returns an
// error string when a hard requirement (store context, Redis, channel) is missing.

type Env = Record<string, string | undefined>;

export type RuntimeResult = { ok: true; deps: PipelineDeps; channel: GoogleChannel } | { ok: false; error: string };

export function buildRuntime(env: Env = process.env): RuntimeResult {
  const config = getPoAgentConfig(env);
  if (!config.enabled) return { ok: false, error: "PO agent is disabled (PO_AGENT_ENABLED)" };

  const ctx = tryGetStoreContext(env);
  if (!ctx) return { ok: false, error: "BigCommerce store context not configured" };

  const redis = getRedis(env);
  if (!redis) return { ok: false, error: "Redis is required for processing (UPSTASH_REDIS_REST_URL/TOKEN)" };
  const store = createPoStore(redis);

  const creds = googleCredsFromEnv(env);
  if (!creds) return { ok: false, error: "Gmail OAuth credentials not configured (GOOGLE_PO_*)" };

  const mailbox = env.PO_AGENT_MAILBOX ?? env.GOOGLE_PO_MAILBOX ?? "";
  const channel = new GoogleChannel({ mailbox, creds, pubsubTopic: env.GOOGLE_PO_PUBSUB_TOPIC });

  const sendMail: MailSender | undefined = config.escalationEmail
    ? (to, subject, text) => channel.sendEmail(to, subject, text)
    : undefined;

  const deps: PipelineDeps = {
    ctx,
    config,
    store,
    channel,
    extract: resolveExtractor(env),
    sendMail,
    mailbox,
    now: () => new Date().toISOString(),
  };
  return { ok: true, deps, channel };
}
