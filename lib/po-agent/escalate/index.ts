import type { PoAgentConfig } from "../config";
import type { PoStore } from "../store";
import type { PoSession } from "../types";
import { postSlack } from "./slack";

// Escalation fan-out: review queue (always on) + Slack + rep-inbox email, each channel
// independently toggled by config. The review queue is the durable record; email/Slack
// are best-effort notifications.

export type MailSender = (to: string, subject: string, text: string) => Promise<boolean>;

export interface EscalateDeps {
  config: PoAgentConfig;
  store?: PoStore;
  sendMail?: MailSender;
  now: () => string;
}

export function escalationSummary(session: PoSession, reasons: string[]): string {
  const company = session.buyer?.companyName ?? "unknown company";
  const email = session.buyer?.email ?? "unknown sender";
  const lines = session.resolution?.length ?? 0;
  return `[PO agent] Needs review: ${company} — ${reasons.join(", ")}\nBuyer: ${email}\nSession: ${session.id}\nLines: ${lines}\nState: ${session.state}`;
}

export function escalationEmailBody(session: PoSession, reasons: string[]): string {
  const extractedLines = (session.extracted?.lines ?? [])
    .map((l) => `  - ${l.rawText}${l.sku ? ` [${l.sku}]` : ""}${l.quantity != null ? ` x${l.quantity}` : ""}`)
    .join("\n");
  const issues = (session.validation ?? []).map((i) => `  - ${i.kind}: ${i.message}`).join("\n");
  return [
    `A purchase order needs manual review.`,
    ``,
    `Reasons: ${reasons.join(", ")}`,
    `Company: ${session.buyer?.companyName ?? "unknown"}`,
    `Buyer: ${session.buyer?.email ?? "unknown"}`,
    `Session: ${session.id}`,
    ``,
    `Extracted lines:`,
    extractedLines || "  (none)",
    ``,
    `Outstanding issues:`,
    issues || "  (none)",
  ].join("\n");
}

export async function fanOutEscalation(
  deps: EscalateDeps,
  session: PoSession,
  reasons: string[],
): Promise<Array<"email" | "slack" | "queue">> {
  const notified: Array<"email" | "slack" | "queue"> = [];

  if (deps.store) {
    await deps.store.enqueue("escalated", session.id, Date.parse(deps.now()) || 0);
    notified.push("queue");
  }

  if (deps.config.slackWebhookUrl) {
    const ok = await postSlack(deps.config.slackWebhookUrl, escalationSummary(session, reasons));
    if (ok) notified.push("slack");
  }

  if (deps.config.escalationEmail && deps.sendMail) {
    const subject = `[PO agent] Needs review: ${session.buyer?.companyName ?? "unknown"} — ${reasons.join(", ")}`;
    const ok = await deps.sendMail(deps.config.escalationEmail, subject, escalationEmailBody(session, reasons));
    if (ok) notified.push("email");
  }

  return notified;
}
