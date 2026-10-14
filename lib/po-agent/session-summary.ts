import { sessionMessages } from "./messages";
import { personSummary } from "./session-view";
import { summarizeOutcome } from "./summary";
import type { PoSession, SessionSummary } from "./types";

// The search-index row for a session: what the Sessions list shows without loading the
// whole session. Pure. Bump SUMMARY_VERSION when the shape changes — the search back-fills
// older index entries from their sessions on read.

export const SUMMARY_VERSION = 3;

const WHY_CAP = 240;
const SKU_CAP = 25;

/** A person action that changes how the session stands (notes and replies don't). */
function isOutcomeAction(event: string): boolean {
  return event === "dismissed" || event === "expired" || event === "draft_approved" || event.startsWith("forced_");
}

/** How the session stands, in one sentence: the latest decide-stage step (held, submitted,
 * decided — the same text as the thread's run divider) or person action that changed the
 * outcome. Sessions from before decision steps fall back to the outcome summary. */
export function whyOf(session: PoSession): string {
  for (let i = session.audit.length - 1; i >= 0; i--) {
    const a = session.audit[i];
    if (!a.summary) continue;
    if (a.stage === "decide") return clip(a.summary);
    if (isOutcomeAction(a.event)) return clip(a.stage === "human" ? personSummary(a.summary) : a.summary);
  }
  const outcome = summarizeOutcome(session);
  return clip(outcome.reasons[0] ?? outcome.headline);
}

function clip(s: string): string {
  return s.length > WHY_CAP ? `${s.slice(0, WHY_CAP - 1)}…` : s;
}

export function summaryOf(s: PoSession): SessionSummary {
  const lines = s.resolution ?? [];
  const messages = sessionMessages(s);
  const skus = [...new Set(lines.map((l) => l.matchedSku ?? l.line.sku).filter((x): x is string => Boolean(x)))];
  return {
    id: s.id,
    company: s.buyer?.companyName ?? "",
    email: s.buyer?.email || s.inbound?.from || "",
    poNumber: s.extracted?.poNumber ?? "",
    state: s.state,
    decision: s.decision?.kind,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    v: SUMMARY_VERSION,
    why: whyOf(s),
    linesReady: lines.filter((l) => l.issues.length === 0).length,
    linesTotal: lines.length,
    messagesIn: messages.filter((m) => m.direction === "in").length,
    messagesOut: messages.filter((m) => m.direction === "out" && m.audience === "buyer").length,
    skus: skus.slice(0, SKU_CAP),
    ...(s.simulated || s.channel === "simulator" ? { simulated: true } : {}),
  };
}
