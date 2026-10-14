import { SimulatorChannel } from "../channel/simulator";
import { sendHeldDraft } from "../messages";
import { draftApprovedStep } from "../decision-steps";
import type { PoSession } from "../types";
import { actionForPurpose } from "./conversation";

// Approving a held draft: a person sends what the agent drafted (or their edit of it), and
// the thread moves on as if the agent had sent it — a quote completes, a question waits for
// the customer. Simulated sessions only, so the send is always captured.

export async function approveHeldDraft(
  session: PoSession,
  messageId: string,
  opts: { text?: string; actor: string },
  now: () => string = () => new Date().toISOString(),
): Promise<{ ok: true } | { error: string; status: number }> {
  const draft = session.messages?.find((m) => m.id === messageId);
  if (!draft || draft.status !== "held") return { error: "No held draft with that id.", status: 404 };
  const edited = opts.text != null && opts.text !== draft.text;

  const sent = await sendHeldDraft(new SimulatorChannel(), session, messageId, { text: opts.text, actor: opts.actor }, now);
  if (!sent || sent.status === "failed") return { error: `Send failed: ${sent?.error ?? "unknown"}`, status: 502 };

  const run = sent.run ?? 1;
  session.audit.push({ at: now(), ...draftApprovedStep(opts.actor, sent, edited), run, actor: opts.actor, ...(edited ? { note: sent.text } : {}) });

  const action = actionForPurpose(sent.purpose);
  const rules = session.rules;
  if (rules) {
    rules.lastAction = action;
    const record = [...rules.records].reverse().find((r) => r.run === run);
    if (record) {
      record.reply_status = "sent";
      record.already_sent_to_customer = sent.text;
    }
  }
  if (action === "CLARIFY") {
    session.state = "clarifying";
    if (rules) {
      rules.clarificationRoundsUsed += 1;
      session.clarificationRounds = rules.clarificationRoundsUsed;
    }
  } else if (action === "ESCALATE") {
    session.state = "escalated";
  } else {
    session.state = "completed_quote";
  }
  session.updatedAt = now();
  return { ok: true };
}
