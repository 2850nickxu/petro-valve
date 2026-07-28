import type { StoreContext } from "@/lib/bc/store-context";
import { getCompanySuperAdmins, getCompanyAdmins, isEmail } from "@/lib/bc/recipients";
import { getCompany } from "@/lib/bc/companies";
import type { PoAgentConfig } from "../config";
import type { InboundMessage } from "../channel/types";
import type { PoSession } from "../types";

// Below-contract forwarding: when a PO escalates AND one or more lines are priced BELOW the
// company's contract price, forward the original PO to the company's sales rep (Super Admin)
// and Admin-role user so a human can catch under-pricing / a stale contract. Every number
// here comes from validated data (the price_mismatch issue's { stated, calculated }) — the
// model never invents figures. Gated by config.forwardPriceMismatch; wired into the pipeline
// escalate branch only (not clarify, not dry-run).

export interface BelowContractLine {
  ref: string;
  stated: number;
  calculated: number;
  delta: number;
}

/** price_mismatch issues where the buyer's stated price is below the contract price. */
export function belowContractLines(session: PoSession): BelowContractLine[] {
  const out: BelowContractLine[] = [];
  for (const i of session.validation ?? []) {
    if (i.kind !== "price_mismatch" || !i.data) continue;
    const stated = i.data.stated;
    const calculated = i.data.calculated;
    if (typeof stated === "number" && typeof calculated === "number" && stated < calculated) {
      out.push({ ref: i.lineRef ?? "line", stated, calculated, delta: calculated - stated });
    }
  }
  return out;
}

export interface ForwardDeps {
  ctx: StoreContext;
  config: PoAgentConfig;
  sendEmail: (to: string, subject: string, text: string) => Promise<boolean>;
}

function forwardBody(session: PoSession, message: InboundMessage, below: BelowContractLine[]): string {
  const lines = below
    .map((b) => `  - ${b.ref}: PO price $${b.stated.toFixed(2)} vs contract $${b.calculated.toFixed(2)} (−$${b.delta.toFixed(2)})`)
    .join("\n");
  return [
    `A purchase order escalated for review because one or more lines are priced BELOW the company's contract price.`,
    ``,
    `Company: ${session.buyer?.companyName ?? "unknown"}`,
    `Buyer: ${session.buyer?.email ?? "unknown"}`,
    `Session: ${session.id}`,
    ``,
    `Below-contract lines (PO vs contract):`,
    lines || "  (none)",
    ``,
    `----- Original message -----`,
    `Subject: ${message.subject || "(none)"}`,
    ``,
    message.bodyText || "(no body)",
  ].join("\n");
}

/**
 * Forward the escalated below-contract PO to the sales rep(s) + admin(s), deduped, with a
 * company-email fallback. Returns the emails actually notified (empty when disabled, when no
 * below-contract line exists, or when no recipient resolves).
 */
export async function forwardBelowContractPo(
  deps: ForwardDeps,
  session: PoSession,
  message: InboundMessage,
): Promise<string[]> {
  if (!deps.config.forwardPriceMismatch) return [];
  const below = belowContractLines(session);
  if (!below.length) return [];
  const companyId = session.buyer?.companyId;
  if (!companyId) return [];

  const [reps, admins] = await Promise.all([
    getCompanySuperAdmins(deps.ctx, companyId),
    getCompanyAdmins(deps.ctx, companyId),
  ]);

  const buyerEmail = session.buyer?.email?.toLowerCase();
  const seen = new Set<string>();
  const recipients: string[] = [];
  for (const c of [...reps, ...admins]) {
    const e = c.email.toLowerCase();
    if (e === buyerEmail || seen.has(e)) continue;
    seen.add(e);
    recipients.push(c.email);
  }

  // Fallback: the company's own email when neither reps nor admins resolve.
  if (!recipients.length) {
    const company = await getCompany(deps.ctx, companyId);
    if (isEmail(company?.companyEmail)) recipients.push(company!.companyEmail!);
  }
  if (!recipients.length) return [];

  const subject = `FWD: ${message.subject || "Purchase order"} — below-contract price flagged`;
  const text = forwardBody(session, message, below);

  const notified: string[] = [];
  for (const to of recipients) {
    if (await deps.sendEmail(to, subject, text)) notified.push(to);
  }
  return notified;
}
