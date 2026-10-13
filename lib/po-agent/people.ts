// How people are named across the app. There are no per-user logins: whoever acts in the
// app (replies, notes, forces, dismisses, reprocesses) is the "Sales agent", and a customer
// is identified by their email address. Both the customer admin and Silk see the same app.

export const SALES_AGENT = "Sales agent";

/** Sessions saved before the Sales agent label recorded the actor as "staff". */
const DEFAULT_ACTORS = new Set(["", "staff", SALES_AGENT.toLowerCase()]);

/** Display name for whoever acted: "Sales agent", unless a named identity was recorded. */
export function actorLabel(actor?: string | null): string {
  const a = actor?.trim() ?? "";
  return DEFAULT_ACTORS.has(a.toLowerCase()) ? SALES_AGENT : a;
}

/** True when the actor is the generic Sales agent (no named identity). */
export function isDefaultActor(actor?: string | null): boolean {
  return actorLabel(actor) === SALES_AGENT;
}

/** The customer, by email: the matched buyer's address, else the sender, else a placeholder. */
export function customerEmail(s: { buyer?: { email?: string } | null; inbound?: { from?: string } | null }): string {
  return s.buyer?.email || s.inbound?.from || "Unknown sender";
}
