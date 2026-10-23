import { sessionMessages } from "./messages";
import { actorLabel } from "./people";
import type { AuditEntry, DecisionStage, PoSession, SessionMessage, SourceRef, StepOutcome, StepSetting } from "./types";

// View model for the session detail page: the conversation thread and the decision trail,
// both read straight from what the pipeline already stores (session.messages and
// session.audit). Pure — no I/O, never mutates the session. Every word here comes from code
// templates or stored data, never from the model.

/* ---------------------------------------------------------------- time */

/** "Oct 9, 14:32" — shared by the UTC stamp and the viewer-local one (components/local-time). */
export const STAMP_FORMAT: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
};

const STAMP = new Intl.DateTimeFormat("en-US", { ...STAMP_FORMAT, timeZone: "UTC" });

/** "Oct 9, 14:32" in UTC — the page states the zone once. */
export function stamp(iso: string): string {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? STAMP.format(t) : iso;
}

/* ---------------------------------------------------------------- decision trail */

export type OutcomeTone = "neutral" | "warning" | "danger";

/** Positive outcomes stay neutral; colour is kept for steps that need attention. */
export const OUTCOME: Record<StepOutcome, { label: string; tone: OutcomeTone }> = {
  known_account: { label: "Known account", tone: "neutral" },
  unknown_sender: { label: "Unknown sender", tone: "warning" },
  guest: { label: "Guest", tone: "neutral" },
  confidence_high: { label: "Confidence high", tone: "neutral" },
  confidence_medium: { label: "Confidence medium", tone: "warning" },
  confidence_low: { label: "Confidence low", tone: "danger" },
  ok: { label: "OK", tone: "neutral" },
  flagged: { label: "Flagged", tone: "warning" },
  clarify: { label: "Clarify", tone: "warning" },
  order: { label: "Order", tone: "neutral" },
  quote: { label: "Quote", tone: "neutral" },
  rejected: { label: "Rejected", tone: "neutral" },
  needs_review: { label: "Needs review", tone: "warning" },
  sent: { label: "Sent", tone: "neutral" },
  failed: { label: "Failed", tone: "danger" },
  resolved_by_buyer: { label: "Resolved by buyer", tone: "neutral" },
  held: { label: "Held for review", tone: "warning" },
  no_response: { label: "No response", tone: "neutral" },
  error: { label: "Error", tone: "danger" },
};

const STAGE_LABEL: Record<DecisionStage, string> = {
  received: "Received",
  identify: "Identify",
  classify: "Classify",
  extract: "Extract",
  resolve: "Resolve",
  price: "Price",
  validate: "Validate",
  decide: "Decide",
  draft: "Draft",
  outbound: "Outbound",
  human: "Sales agent",
  lifecycle: "Follow-up",
};

const STEP_TITLE: Record<string, string> = {
  received: "Received the email",
  reopened: "Reopened on a new email",
  identified: "Identified the sender",
  extracted: "Read the PO",
  triaged: "Triaged the email",
  classified: "Classified the message",
  rules_decided: "Applied the decision rules",
  drafted: "Wrote the reply",
  held_draft: "Held a draft for review",
  handoff: "Handed off to a person",
  draft_approved: "Approved a held draft",
  contract_price_accepted: "Buyer accepted the store price",
  price_review_requested: "Buyer asked for sales pricing",
  resolved: "Searched the catalog",
  priced: "Looked up store prices",
  validated: "Checked the account and lines",
  decided: "Decided what to do",
  submitted: "Submitted to BigCommerce",
  held: "Held for review",
  outbound: "Sent an email",
  forwarded_below_contract: "Forwarded the PO",
  send_failed: "An email failed to send",
  error: "Hit an error",
  note: "Added an internal note",
  dismissed: "Dismissed the session",
  forced_order: "Forced an order",
  forced_quote: "Forced a quote",
  replied: "Replied to the buyer",
  reprocessed: "Reprocessed the session",
  reminded: "Sent a reminder",
  expired: "Expired the session",
};

export function stepTitle(entry: Pick<AuditEntry, "event" | "outcome">): string {
  if (entry.event === "outbound" && entry.outcome === "failed") return "An email failed to send";
  const t = STEP_TITLE[entry.event];
  if (t) return t;
  const words = entry.event.replace(/[_:]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export interface TrailStep {
  /** 1-based, across the whole trail — what thread links point at. */
  n: number;
  at: string;
  event: string;
  stage?: string;
  title: string;
  /** Plain-language explanation. Older events carry only raw detail, shortened. */
  summary?: string;
  /** Free text a person attached (note, force, dismiss). */
  note?: string;
  actor?: string;
  outcome?: { label: string; tone: OutcomeTone };
  setting?: StepSetting;
  sources: SourceRef[];
}

export interface TrailRun {
  key: string;
  /** null = events saved before decision steps existed. */
  run: number | null;
  label: string;
  /** When the email that started the run arrived; shown in the viewer's local time. */
  at?: string;
  steps: TrailStep[];
}

const LEGACY_DETAIL_CAP = 160;

/** Person-step summaries written before the Sales agent label say "Staff …". */
export function personSummary(summary: string): string {
  return summary.startsWith("Staff ") ? `Sales agent ${summary.slice("Staff ".length)}` : summary;
}

function legacyDetail(detail: unknown): string | undefined {
  if (detail == null) return undefined;
  const s = typeof detail === "string" ? detail : JSON.stringify(detail);
  return s.length > LEGACY_DETAIL_CAP ? `${s.slice(0, LEGACY_DETAIL_CAP)}…` : s;
}

function runHeading(run: number | null, messages: SessionMessage[]): Pick<TrailRun, "label" | "at"> {
  if (run == null) return { label: "Earlier events (before the decision trail)" };
  const trigger = messages.find((m) => m.direction === "in" && m.run === run);
  const what = run === 1 ? "New email" : "Buyer replied";
  return trigger ? { label: `Run ${run} · ${what}`, at: trigger.at } : { label: `Run ${run}` };
}

/** The audit log as numbered steps, oldest first, grouped into consecutive runs. */
export function decisionTrail(session: PoSession): TrailRun[] {
  const messages = sessionMessages(session);
  const runs: TrailRun[] = [];
  session.audit.forEach((a, i) => {
    const run = a.run ?? null;
    let group = runs[runs.length - 1];
    if (!group || group.run !== run) {
      group = { key: `g${runs.length}`, run, ...runHeading(run, messages), steps: [] };
      runs.push(group);
    }
    group.steps.push({
      n: i + 1,
      at: a.at,
      event: a.event,
      stage: a.stage ? STAGE_LABEL[a.stage] : undefined,
      title: stepTitle(a),
      summary: a.summary ? (a.stage === "human" ? personSummary(a.summary) : a.summary) : a.note ? undefined : legacyDetail(a.detail),
      note: a.note,
      actor: a.stage === "human" || (!a.stage && a.actor) ? actorLabel(a.actor) : undefined,
      outcome: a.outcome ? OUTCOME[a.outcome] : undefined,
      setting: a.setting,
      sources: a.sources ?? [],
    });
  });
  return runs;
}

/* ---------------------------------------------------------------- conversation thread */

export type ThreadSide = "customer" | "agent" | "internal";

export type ThreadEntry =
  | {
      kind: "message";
      key: string;
      at: string;
      side: ThreadSide;
      message: SessionMessage;
      /** The trail step that sent or received this message, when one references it. */
      stepN?: number;
    }
  | { kind: "note"; key: string; at: string; side: "internal"; text: string; actor?: string; run?: number; stepN: number }
  | { kind: "run"; key: string; at: string; run: number; summary: string; stepN: number };

const PURPOSE_LABEL: Record<NonNullable<SessionMessage["purpose"]>, string> = {
  rejection: "Rejection",
  triage: "Triage",
  clarification: "Clarifying question",
  escalation_notice: "Escalation notice",
  first_order_confirm: "First-order confirmation",
  order_confirmation: "Order confirmation",
  quote_confirmation: "Quote",
  checkout_link_resend: "Checkout link",
};

const KIND_LABEL: Record<SessionMessage["kind"], string> = {
  inbound: "Customer email",
  auto_reply: "Reply",
  staff_reply: "Sales agent reply",
  reminder: "Reminder",
  expiry: "Expiry notice",
  escalation_email: "Escalation email",
  below_contract_forward: "Below-contract forward",
};

/** Short tag for what an email is: "Clarifying question", "Reminder", "Escalation email". */
export function messageLabel(m: SessionMessage): string {
  if (m.kind === "auto_reply" && m.purpose) return PURPOSE_LABEL[m.purpose];
  return KIND_LABEL[m.kind];
}

export function messageSide(m: SessionMessage): ThreadSide {
  if (m.direction === "in") return "customer";
  return m.audience === "internal" ? "internal" : "agent";
}

/** Steps reference messages as sources; the first one that does is the message's "why". */
function stepsByMessage(audit: AuditEntry[]): Map<string, number> {
  const out = new Map<string, number>();
  audit.forEach((a, i) => {
    for (const s of a.sources ?? []) {
      if (s.type === "message" && s.id && !out.has(s.id)) out.set(s.id, i + 1);
    }
  });
  return out;
}

function entryRun(e: ThreadEntry): number {
  return (e.kind === "run" ? e.run : e.kind === "message" ? e.message.run : e.run) ?? 0;
}

/** On a timestamp tie: earlier run first; within a run, the customer's email, then the
 * run's decision, then what followed. */
function tieRank(e: ThreadEntry): number {
  if (e.kind === "message" && e.side === "customer") return 0;
  return e.kind === "run" ? 1 : 2;
}

/** Every message, internal note and run outcome on the session, oldest first. Ties keep
 * the order things were recorded in. */
export function conversationThread(session: PoSession): ThreadEntry[] {
  const steps = stepsByMessage(session.audit);
  const entries: ThreadEntry[] = sessionMessages(session).map((m) => ({
    kind: "message",
    key: m.id,
    at: m.at,
    side: messageSide(m),
    message: m,
    stepN: steps.get(m.id),
  }));

  // One divider per run, carrying how it ended — the "what happened" between the
  // customer's email and the agent's answer. The run's last decide-stage step wins, so a
  // decision that was then held, submitted or reprocessed shows its final outcome.
  const decided = new Map<number, { at: string; summary: string; stepN: number }>();
  session.audit.forEach((a, i) => {
    if (a.event === "note" && a.note) {
      entries.push({ kind: "note", key: `note-${i}`, at: a.at, side: "internal", text: a.note, actor: actorLabel(a.actor), run: a.run, stepN: i + 1 });
    }
    if (a.stage === "decide" && a.run != null && a.summary) {
      decided.set(a.run, { at: a.at, summary: a.summary, stepN: i + 1 });
    }
  });
  for (const [run, d] of decided) {
    entries.push({ kind: "run", key: `run-${run}`, at: d.at, run, summary: d.summary, stepN: d.stepN });
  }

  return entries
    .map((e, i) => ({ e, i }))
    .sort((x, y) => (x.e.at < y.e.at ? -1 : x.e.at > y.e.at ? 1 : entryRun(x.e) - entryRun(y.e) || tieRank(x.e) - tieRank(y.e) || x.i - y.i))
    .map(({ e }) => e);
}
