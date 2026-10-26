import { getRedis } from "@/lib/redis";
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import { canSeeSettingGroup, type AdminView } from "./admin-view";

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
  help?: string;
}

export const SETTINGS_FIELDS: FieldDef[] = [
  // AI (BYO provider)
  { key: "PO_AGENT_MODEL", label: "Model", group: "AI", placeholder: "anthropic:claude-sonnet-4-6", help: "provider:model-id, e.g. anthropic:claude-sonnet-4-6 or openai:gpt-4o" },
  { key: "ANTHROPIC_API_KEY", label: "Anthropic API key", group: "AI", secret: true, help: "Required when using any anthropic:* model" },
  { key: "OPENAI_API_KEY", label: "OpenAI API key", group: "AI", secret: true, help: "Required when using any openai:* model" },
  { key: "GOOGLE_GENERATIVE_AI_API_KEY", label: "Google AI API key", group: "AI", secret: true, help: "Required when using any google:* model" },
  // Escalation
  { key: "PO_AGENT_ESCALATION_EMAIL", label: "Rep escalation email", group: "Escalation", placeholder: "reps@company.com", help: "Email address where escalated or flagged POs are forwarded" },
  { key: "PO_AGENT_SLACK_WEBHOOK_URL", label: "Slack webhook URL", group: "Escalation", secret: true, help: "Incoming Webhook URL for the Slack channel that receives escalation alerts" },
  { key: "PO_AGENT_FORWARD_PRICE_MISMATCH", label: "Forward below-contract POs to sales rep + admin", group: "Escalation", type: "bool", help: "When true, POs priced below the buyer's contract rate are forwarded to the escalation email instead of auto-accepted" },
  // Email channel
  { key: "PO_AGENT_CHANNEL", label: "Channel", group: "Email channel", type: "select", options: ["google", "microsoft"], help: "Choose the email provider that delivers inbound POs" },
  { key: "PO_AGENT_MAILBOX", label: "Monitored mailbox", group: "Email channel", placeholder: "po@company.com", help: "The email address buyers send purchase orders to" },
  { key: "PO_AGENT_INBOUND_SECRET", label: "Inbound webhook secret", group: "Email channel", secret: true, help: "Token appended as ?token= to the inbound webhook URL to authenticate push deliveries" },
  { key: "GOOGLE_PO_CLIENT_ID", label: "Gmail OAuth client id", group: "Email channel", help: "OAuth 2.0 client ID from Google Cloud Console (Web application type)" },
  { key: "GOOGLE_PO_CLIENT_SECRET", label: "Gmail OAuth client secret", group: "Email channel", secret: true, help: "OAuth 2.0 client secret paired with the client ID above" },
  { key: "GOOGLE_PO_REFRESH_TOKEN", label: "Gmail refresh token", group: "Email channel", secret: true, help: "Populated automatically after you click Connect Gmail and complete the OAuth flow" },
  { key: "GOOGLE_PO_PUBSUB_TOPIC", label: "Gmail Pub/Sub topic", group: "Email channel", help: "Full topic resource name, e.g. projects/my-project/topics/gmail-po-push" },
  { key: "MS_PO_TENANT_ID", label: "Microsoft tenant id", group: "Email channel", help: "Azure AD tenant (directory) ID for your Microsoft 365 organisation" },
  { key: "MS_PO_CLIENT_ID", label: "Microsoft client id", group: "Email channel", help: "App registration client ID in Azure AD" },
  { key: "MS_PO_CLIENT_SECRET", label: "Microsoft client secret", group: "Email channel", secret: true, help: "Client secret value from the Azure AD app registration" },
  { key: "MS_PO_MAILBOX", label: "Microsoft mailbox (UPN)", group: "Email channel", help: "User Principal Name of the monitored mailbox, e.g. po@company.com" },
  // BigCommerce (manual override; the installed app supplies an OAuth token automatically)
  { key: "BIGCOMMERCE_STORE_HASH", label: "Store hash", group: "BigCommerce", help: "Short alphanumeric identifier in your store URL, e.g. abc123" },
  { key: "BIGCOMMERCE_ACCESS_TOKEN", label: "Store access token", group: "BigCommerce", secret: true, help: "Store API token with B2B Edition scope = modify (skip if using the installed app — it provides its own token)" },
  { key: "BIGCOMMERCE_CHANNEL_ID", label: "Channel id", group: "BigCommerce", type: "number", help: "Storefront channel to associate orders/quotes with (default 1 for the main channel)" },
  // Commerce platform — which store adapter this deployment quotes from (lib/commerce)
  { key: "PO_AGENT_COMMERCE", label: "Commerce platform", group: "Store", type: "select", options: ["bigcommerce", "magento"], help: "The store the agent matches, prices and quotes against" },
  // Magento (Petro Valve) — read-only except guest carts. Two stores, one switch.
  { key: "MAGENTO_STORE", label: "Active store", group: "Magento", type: "select", options: ["production", "sandbox"], help: "Which Magento store the agent uses: production or the sandbox (test site)" },
  { key: "MAGENTO_BASE_URL", label: "Store URL", group: "Magento", placeholder: "https://petrovalve.com", help: "The store's https origin; the REST API lives under /rest/V1" },
  { key: "MAGENTO_ADMIN_USERNAME", label: "Admin username", group: "Magento", help: "Admin user the agent signs in as to read the catalog" },
  { key: "MAGENTO_ADMIN_PASSWORD", label: "Admin password", group: "Magento", secret: true, help: "Password for the admin user above" },
  { key: "MAGENTO_GUEST_CART_WRITES", label: "Allow guest-cart writes on production", group: "Magento", type: "bool", help: "Lets the agent create guest carts and add items to them on the production store. It never writes anything else." },
  { key: "MAGENTO_SANDBOX_BASE_URL", label: "Sandbox URL", group: "Magento", placeholder: "https://petrovalve-test.epicorcommerce.com", help: "The sandbox (test site) https origin" },
  { key: "MAGENTO_SANDBOX_ADMIN_USERNAME", label: "Sandbox admin username", group: "Magento", help: "Leave empty to use the production admin login" },
  { key: "MAGENTO_SANDBOX_ADMIN_PASSWORD", label: "Sandbox admin password", group: "Magento", secret: true, help: "Leave empty to use the production admin password" },
  { key: "MAGENTO_SANDBOX_GUEST_CART_WRITES", label: "Allow guest-cart writes on the sandbox", group: "Magento", type: "bool", help: "Same as above, for the sandbox only. Production keeps its own switch." },
  { key: "MAGENTO_CART_LINK_SECRET", label: "Cart link secret", group: "Magento", secret: true, help: "Signs cart links. Shared with the Silk Magento module that opens them" },
  { key: "MAGENTO_CART_LINK_PATH", label: "Cart link path", group: "Magento", placeholder: "/silkcartlink/cart/open", help: "Path the Silk Magento module serves cart links on" },
  // Workflow
  { key: "PO_AGENT_ENABLED", label: "Enabled", group: "Workflow", type: "bool" },
  { key: "PO_AGENT_MODE", label: "Mode", group: "Workflow", type: "select", options: ["auto", "review"], help: "auto: submit orders without human approval; review: hold every PO in a queue for staff sign-off" },
  { key: "PO_AGENT_PO_PAYMENT_CODES", label: "Pay-on-account codes", group: "Workflow", placeholder: "cheque,purchase_order", help: "Comma-separated BigCommerce payment method codes accepted as pay-on-account" },
  { key: "PO_AGENT_PRICE_TOLERANCE_PCT", label: "Price tolerance %", group: "Workflow", type: "number", help: "Percentage below catalog price still accepted without escalation (e.g. 2 allows up to 2% under)" },
  { key: "PO_AGENT_MAX_CLARIFICATIONS", label: "Max clarifications", group: "Workflow", type: "number", help: "How many clarification reply rounds the agent attempts before escalating" },
  { key: "PO_AGENT_FIRST_ORDER_CONFIRM", label: "First-order confirm", group: "Workflow", type: "bool", help: "When true, the agent sends a confirmation email before submitting the very first order from a new buyer" },
  { key: "PO_AGENT_DAILY_SUBMIT_CAP", label: "Daily submit cap", group: "Workflow", type: "number", help: "Maximum orders/quotes submitted per calendar day (0 = unlimited)" },
  { key: "PO_AGENT_SIMULATOR_SEND", label: "Sandbox mode (simulator submits real orders/quotes)", group: "Workflow", type: "bool", help: "When true, simulator sessions submit to BigCommerce and trigger real downstream effects — use with care" },
  { key: "PO_AGENT_SIMULATOR_SEND_EMAILS", label: "Sandbox: also send emails", group: "Workflow", type: "bool", help: "When true, simulator sessions also dispatch outbound reply emails" },
  // Decision rules (draft) — docs/petrovalve-offline-po-decision-rules.md §5. Used by the
  // simulator's conversation mode only until the rules are signed off.
  { key: "PO_AGENT_RULES_INTENT_MIN", label: "Minimum intent confidence", group: "Decision rules", type: "number", placeholder: "0.9", help: "0–1. Below this the request escalates as unclear (I10)" },
  { key: "PO_AGENT_RULES_HOLD_USD", label: "Hold requests above (USD)", group: "Decision rules", type: "number", placeholder: "50000", help: "Quotes whose total is above this are held for review (Q6)" },
  { key: "PO_AGENT_RULES_MAX_LINES", label: "Hold requests with more lines than", group: "Decision rules", type: "number", placeholder: "50", help: "Large requests are held for review (A2)" },
  { key: "PO_AGENT_RULES_MAX_CLARIFY", label: "Clarification rounds", group: "Decision rules", type: "number", placeholder: "1", help: "After this many questions, the next reply is held for a person (T5)" },
  { key: "PO_AGENT_RULES_UNUSUAL_QTY", label: "Unusual quantity", group: "Decision rules", type: "number", placeholder: "10000", help: "A line at or above this quantity is held for review (Q7)" },
  { key: "PO_AGENT_RULES_STAFF_DOMAINS", label: "Staff email domains", group: "Decision rules", placeholder: "petrovalve.com", help: "Comma-separated. Mail from these domains is a staff forward; the draft goes back to the staff member (I11)" },
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

/** Setting keys hidden from an admin view (the customer view doesn't see the AI model). */
export function hiddenSettingKeys(view: AdminView): Set<string> {
  return new Set(SETTINGS_FIELDS.filter((f) => !canSeeSettingGroup(view, f.group)).map((f) => f.key));
}
