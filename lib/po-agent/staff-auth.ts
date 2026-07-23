// Staff-portal gate. This standalone app has no buyer-session auth, so /staff and
// /api/staff are protected by a shared secret (PO_AGENT_STAFF_SECRET) via ?token=, a
// Basic-auth password, or the poa_staff cookie. Edge-safe (no node:crypto) so it can run
// in middleware.

export function staffSecret(env: Record<string, string | undefined> = process.env): string | undefined {
  return env.PO_AGENT_STAFF_SECRET || undefined;
}

/** Constant-time string compare (edge-safe). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export interface StaffCredentials {
  token?: string | null;
  cookie?: string | null;
  /** The base64 payload after "Basic " (user:pass). */
  basic?: string | null;
}

/**
 * @param devOpen when true and no secret is configured, allow (local dev). In production
 * with no secret, deny — never expose PO sessions unauthenticated.
 */
export function isStaffAuthorized(creds: StaffCredentials, secret: string | undefined, devOpen: boolean): boolean {
  if (!secret) return devOpen;
  if (creds.token && safeEqual(creds.token, secret)) return true;
  if (creds.cookie && safeEqual(creds.cookie, secret)) return true;
  if (creds.basic) {
    try {
      const decoded = atob(creds.basic);
      const pass = decoded.slice(decoded.indexOf(":") + 1);
      if (pass && safeEqual(pass, secret)) return true;
    } catch {
      /* malformed */
    }
  }
  return false;
}
