import type { Redis } from "@/lib/redis";

// Preview-deployment sign-in. Vercel previews can't receive the BigCommerce app session
// (the app's load callback points at the production domain) and don't carry
// PO_AGENT_STAFF_SECRET, so a signed-in operator on production mints a short-lived,
// single-use code; redeeming it on a preview creates a Redis-backed session bound to the
// same store. Redis is the trust anchor: previews already share production's Redis, so
// this grants a preview nothing it couldn't already read. Edge-safe (Web Crypto only) so
// the middleware can verify sessions.

type Env = Record<string, string | undefined>;

export const PREVIEW_COOKIE = "poa_preview";
export const PREVIEW_CODE_TTL_S = 10 * 60;
export const PREVIEW_SESSION_TTL_S = 12 * 60 * 60;

const codeKey = (code: string) => `poa:preview:code:${code}`;
const sessionKey = (id: string) => `poa:preview:session:${id}`;

// No 0/O/1/I — the code may be read off one screen and typed into another.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export interface PreviewGrant {
  /** The store the operator was signed into when minting the code; null = global scope. */
  storeHash: string | null;
  createdAt: string;
}

/** True only on Vercel preview deployments — the one place codes can be redeemed. */
export function isPreviewDeployment(env: Env = process.env): boolean {
  return env.VERCEL_ENV === "preview";
}

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let s = "";
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return s.match(/.{4}/g)!.join("-");
}

function randomSessionId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Normalise user input: case-insensitive, dashes/spaces optional. */
export function normalizeCode(input: string): string | null {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (raw.length !== 16 || [...raw].some((c) => !ALPHABET.includes(c))) return null;
  return raw.match(/.{4}/g)!.join("-");
}

/** Mint a single-use sign-in code for the given store. */
export async function createPreviewCode(
  redis: Redis,
  storeHash: string | null,
  now: Date = new Date(),
): Promise<{ code: string; expiresAt: string }> {
  const code = randomCode();
  const grant: PreviewGrant = { storeHash, createdAt: now.toISOString() };
  await redis.cmd(["SET", codeKey(code), JSON.stringify(grant), "EX", PREVIEW_CODE_TTL_S]);
  return { code, expiresAt: new Date(now.getTime() + PREVIEW_CODE_TTL_S * 1000).toISOString() };
}

/** Consume a code (single use) and open a preview session. Null if unknown/expired/used. */
export async function redeemPreviewCode(
  redis: Redis,
  input: string,
  now: Date = new Date(),
): Promise<{ sessionId: string; grant: PreviewGrant } | null> {
  const code = normalizeCode(input);
  if (!code) return null;
  const raw = await redis.cmd<string | null>(["GETDEL", codeKey(code)]);
  if (!raw) return null;
  const minted = JSON.parse(raw) as PreviewGrant;
  const grant: PreviewGrant = { storeHash: minted.storeHash, createdAt: now.toISOString() };
  const sessionId = randomSessionId();
  await redis.cmd(["SET", sessionKey(sessionId), JSON.stringify(grant), "EX", PREVIEW_SESSION_TTL_S]);
  return { sessionId, grant };
}

/** Look up a preview session by its cookie value. */
export async function loadPreviewSession(redis: Redis, sessionId: string | undefined | null): Promise<PreviewGrant | null> {
  if (!sessionId || !/^[0-9a-f]{64}$/.test(sessionId)) return null;
  const raw = await redis.cmd<string | null>(["GET", sessionKey(sessionId)]);
  return raw ? (JSON.parse(raw) as PreviewGrant) : null;
}

export async function endPreviewSession(redis: Redis, sessionId: string | undefined | null): Promise<void> {
  if (sessionId && /^[0-9a-f]{64}$/.test(sessionId)) await redis.cmd(["DEL", sessionKey(sessionId)]);
}
