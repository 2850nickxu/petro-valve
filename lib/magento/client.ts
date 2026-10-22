// Magento 2 REST client — READ-ONLY by construction. The only exported request function is
// magentoGet(); the single non-GET in this module is the admin-token login, which writes no
// catalog/customer/order data. Do not add a POST/PUT/DELETE helper here: the production store
// is read-only for this app (tests/magento/read-only.test.ts enforces it).
//
// Auth: POST /V1/integration/admin/token → bearer token (~4h by default). Tokens are cached
// per store+user and shared across concurrent callers, because each login is a round trip,
// failed logins count toward Magento's admin lockout, and on some versions every login
// persists a token row. On a 401 we log in again ONCE and retry; a second 401 throws.

import type { MagentoContext } from "./magento-context";

/** Refresh comfortably before Magento's default 4h admin-token lifetime. */
const TOKEN_TTL_MS = 3.5 * 60 * 60 * 1000;

export class MagentoApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    body: string,
  ) {
    super(`Magento API error ${status} at ${path}: ${body.slice(0, 500)}`);
    this.name = "MagentoApiError";
  }
}

interface CachedToken {
  token: Promise<string>;
  expiresAt: number;
}

const tokens = new Map<string, CachedToken>();

const cacheKey = (ctx: MagentoContext) => `${ctx.baseUrl}|${ctx.username}`;
const restUrl = (ctx: MagentoContext, path: string) => `${ctx.baseUrl}/rest/V1${path}`;

async function login(ctx: MagentoContext): Promise<string> {
  const path = "/integration/admin/token";
  const res = await fetch(restUrl(ctx, path), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ username: ctx.username, password: ctx.password }),
    cache: "no-store",
  });
  if (!res.ok) {
    // Never echo the request (it carries the password); Magento's body is a generic message.
    const text = await res.text().catch(() => "");
    throw new MagentoApiError(res.status, path, text);
  }
  const token = (await res.json()) as unknown;
  if (typeof token !== "string" || !token) throw new MagentoApiError(res.status, path, "token missing from response");
  return token;
}

function getToken(ctx: MagentoContext, now = Date.now()): Promise<string> {
  const key = cacheKey(ctx);
  const hit = tokens.get(key);
  if (hit && hit.expiresAt > now) return hit.token;
  const token = login(ctx);
  tokens.set(key, { token, expiresAt: now + TOKEN_TTL_MS });
  // A failed login must not poison the cache for the next caller.
  token.catch(() => {
    if (tokens.get(key)?.token === token) tokens.delete(key);
  });
  return token;
}

function invalidateToken(ctx: MagentoContext, stale: Promise<string>): void {
  const key = cacheKey(ctx);
  if (tokens.get(key)?.token === stale) tokens.delete(key);
}

/** Drop every cached token (tests; or after rotating the admin password). */
export function clearMagentoTokens(): void {
  tokens.clear();
}

/**
 * GET a Magento REST path (relative to /rest/V1, e.g. "/products?searchCriteria..."),
 * returning parsed JSON. Throws MagentoApiError on non-2xx.
 */
export async function magentoGet<T>(ctx: MagentoContext, path: string): Promise<T> {
  if (!path.startsWith("/")) throw new Error(`magentoGet: path must be relative to /rest/V1, got "${path}"`);
  for (let attempt = 0; ; attempt++) {
    const token = getToken(ctx);
    const res = await fetch(restUrl(ctx, path), {
      method: "GET",
      headers: { Authorization: `Bearer ${await token}`, Accept: "application/json" },
      cache: "no-store",
    });
    if (res.status === 401 && attempt === 0) {
      invalidateToken(ctx, token);
      continue;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new MagentoApiError(res.status, path, text);
    }
    return (await res.json()) as T;
  }
}

// ── searchCriteria query builder ─────────────────────────────────────────────

export type ConditionType = "eq" | "neq" | "in" | "like" | "gt" | "gteq" | "lt" | "lteq" | "notnull";

/** One AND-ed filter group; `[field, value, conditionType?]`. */
export type Filter = [field: string, value: string, condition?: ConditionType];

/**
 * Build a /V1/products-style query string. Each filter is its own filterGroup (AND).
 * `fields` is Magento's response field filter, e.g. "items[sku,price],total_count".
 */
export function searchQuery(
  filters: Filter[],
  opts: { pageSize?: number; currentPage?: number; fields?: string } = {},
): string {
  const parts = filters.map(([field, value, condition], i) => {
    const p = `searchCriteria[filterGroups][${i}][filters][0]`;
    return (
      `${p}[field]=${encodeURIComponent(field)}&${p}[value]=${encodeURIComponent(value)}` +
      (condition ? `&${p}[conditionType]=${condition}` : "")
    );
  });
  if (opts.pageSize) parts.push(`searchCriteria[pageSize]=${opts.pageSize}`);
  if (opts.currentPage) parts.push(`searchCriteria[currentPage]=${opts.currentPage}`);
  if (opts.fields) parts.push(`fields=${encodeURIComponent(opts.fields)}`);
  return parts.join("&");
}
