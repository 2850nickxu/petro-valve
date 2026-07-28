import { getRedis } from "@/lib/redis";
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

// Persisted, UI-editable configuration. Stored in Redis per scope ("global" or
// "store:{hash}"); secret values are encrypted at rest (AES-256-GCM). The effective
// config = these settings layered over process.env (see effective-env.ts). This lets an
// admin configure tokens/keys/behavior from the app instead of env/CLI.

export interface FieldDef {
  key: string;
  label: string;
  group: string;
  secret?: boolean;
  type?: "text" | "number" | "select" | "bool";
  options?: string[];
  placeholder?: string;
}

export const SETTINGS_FIELDS: FieldDef[] = [
  // AI (BYO provider)
  { key: "PO_AGENT_MODEL", label: "Model", group: "AI", placeholder: "anthropic:claude-sonnet-4-6" },
  { key: "ANTHROPIC_API_KEY", label: "Anthropic API key", group: "AI", secret: true },
  { key: "OPENAI_API_KEY", label: "OpenAI API key", group: "AI", secret: true },
  { key: "GOOGLE_GENERATIVE_AI_API_KEY", label: "Google AI API key", group: "AI", secret: true },
  // Escalation
  { key: "PO_AGENT_ESCALATION_EMAIL", label: "Rep escalation email", group: "Escalation", placeholder: "reps@company.com" },
  { key: "PO_AGENT_SLACK_WEBHOOK_URL", label: "Slack webhook URL", group: "Escalation", secret: true },
  { key: "PO_AGENT_FORWARD_PRICE_MISMATCH", label: "Forward below-contract POs to sales rep + admin", group: "Escalation", type: "bool" },
  // Email channel
  { key: "PO_AGENT_CHANNEL", label: "Channel", group: "Email channel", type: "select", options: ["google", "microsoft"] },
  { key: "PO_AGENT_MAILBOX", label: "Monitored mailbox", group: "Email channel", placeholder: "po@company.com" },
  { key: "PO_AGENT_INBOUND_SECRET", label: "Inbound webhook secret", group: "Email channel", secret: true },
  { key: "GOOGLE_PO_CLIENT_ID", label: "Gmail OAuth client id", group: "Email channel" },
  { key: "GOOGLE_PO_CLIENT_SECRET", label: "Gmail OAuth client secret", group: "Email channel", secret: true },
  { key: "GOOGLE_PO_REFRESH_TOKEN", label: "Gmail refresh token", group: "Email channel", secret: true },
  { key: "GOOGLE_PO_PUBSUB_TOPIC", label: "Gmail Pub/Sub topic", group: "Email channel" },
  { key: "MS_PO_TENANT_ID", label: "Microsoft tenant id", group: "Email channel" },
  { key: "MS_PO_CLIENT_ID", label: "Microsoft client id", group: "Email channel" },
  { key: "MS_PO_CLIENT_SECRET", label: "Microsoft client secret", group: "Email channel", secret: true },
  { key: "MS_PO_MAILBOX", label: "Microsoft mailbox (UPN)", group: "Email channel" },
  // BigCommerce (manual override; the installed app supplies an OAuth token automatically)
  { key: "BIGCOMMERCE_STORE_HASH", label: "Store hash", group: "BigCommerce" },
  { key: "BIGCOMMERCE_ACCESS_TOKEN", label: "Store access token", group: "BigCommerce", secret: true },
  { key: "BIGCOMMERCE_CHANNEL_ID", label: "Channel id", group: "BigCommerce", type: "number" },
  // Workflow
  { key: "PO_AGENT_ENABLED", label: "Enabled", group: "Workflow", type: "bool" },
  { key: "PO_AGENT_MODE", label: "Mode", group: "Workflow", type: "select", options: ["auto", "review"] },
  { key: "PO_AGENT_PO_PAYMENT_CODES", label: "Pay-on-account codes", group: "Workflow", placeholder: "cheque,purchase_order" },
  { key: "PO_AGENT_PRICE_TOLERANCE_PCT", label: "Price tolerance %", group: "Workflow", type: "number" },
  { key: "PO_AGENT_MAX_CLARIFICATIONS", label: "Max clarifications", group: "Workflow", type: "number" },
  { key: "PO_AGENT_FIRST_ORDER_CONFIRM", label: "First-order confirm", group: "Workflow", type: "bool" },
  { key: "PO_AGENT_DAILY_SUBMIT_CAP", label: "Daily submit cap", group: "Workflow", type: "number" },
  { key: "PO_AGENT_SIMULATOR_SEND", label: "Sandbox mode (simulator submits real orders/quotes)", group: "Workflow", type: "bool" },
  { key: "PO_AGENT_SIMULATOR_SEND_EMAILS", label: "Sandbox: also send emails", group: "Workflow", type: "bool" },
];

export const SECRET_KEYS = new Set(SETTINGS_FIELDS.filter((f) => f.secret).map((f) => f.key));
export const EDITABLE_KEYS = SETTINGS_FIELDS.map((f) => f.key);

export type SettingsScope = "global" | `store:${string}`;
const keyOf = (scope: SettingsScope) => `poa:config:${scope}`;

function encKey(): Buffer {
  const src = process.env.SETTINGS_ENC_KEY || process.env.BC_APP_CLIENT_SECRET || process.env.PO_AGENT_STAFF_SECRET || "dev-only-key";
  return createHash("sha256").update(src).digest();
}

export function encryptValue(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${enc.toString("base64")}`;
}

export function decryptValue(payload: string): string {
  const parts = payload.split(":");
  if (parts[0] !== "v1") return payload;
  const [, ivb, tagb, eb] = parts;
  const decipher = createDecipheriv("aes-256-gcm", encKey(), Buffer.from(ivb, "base64"));
  decipher.setAuthTag(Buffer.from(tagb, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(eb, "base64")), decipher.final()]).toString("utf8");
}

async function loadRaw(scope: SettingsScope): Promise<Record<string, string>> {
  const redis = getRedis();
  if (!redis) return {};
  const raw = await redis.cmd<string | null>(["GET", keyOf(scope)]);
  return raw ? (JSON.parse(raw) as Record<string, string>) : {};
}

/** Save a partial record. Empty non-secret ⇒ revert to env; empty secret ⇒ keep existing. */
export async function saveSettings(scope: SettingsScope, record: Record<string, string | undefined>): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  const merged = await loadRaw(scope);
  for (const key of EDITABLE_KEYS) {
    if (!(key in record)) continue;
    const v = (record[key] ?? "").trim();
    if (SECRET_KEYS.has(key)) {
      if (v) merged[key] = encryptValue(v); // empty secret leaves existing untouched
    } else if (v) {
      merged[key] = v;
    } else {
      delete merged[key];
    }
  }
  await redis.cmd(["SET", keyOf(scope), JSON.stringify(merged)]);
  return true;
}

/** Decrypted settings for a scope (for merging into env). */
export async function loadSettings(scope: SettingsScope): Promise<Record<string, string>> {
  const raw = await loadRaw(scope);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) out[k] = SECRET_KEYS.has(k) ? decryptValue(v) : v;
  return out;
}

/** UI view: non-secrets show their value; secrets show only whether they are set. */
export async function settingsView(scope: SettingsScope): Promise<Record<string, { value: string; set: boolean; secret: boolean }>> {
  const raw = await loadRaw(scope);
  const out: Record<string, { value: string; set: boolean; secret: boolean }> = {};
  for (const f of SETTINGS_FIELDS) {
    const present = f.key in raw;
    out[f.key] = { value: f.secret ? "" : (raw[f.key] ?? ""), set: present, secret: Boolean(f.secret) };
  }
  return out;
}
