import type { PoAgentConfig } from "./config";
import type { PoStore } from "./store";
import type { EmailChannel, ThreadRef } from "./channel/types";
import type { PoSession } from "./types";
import { draftNudge, draftExpiry } from "./ai/respond";

// Session lifecycle sweep (§7.7): one nudge after N days of buyer silence, then expiry
// after M days. Piggybacks on the poll cron. Idempotent — safe to run repeatedly.

const DAY_MS = 24 * 60 * 60 * 1000;

export interface LifecycleDeps {
  config: PoAgentConfig;
  store: PoStore;
  channel: EmailChannel;
  now: () => string;
}

export interface SweepResult {
  reminded: string[];
  expired: string[];
}

const WAITING_STATES: PoSession["state"][] = ["clarifying", "awaiting_confirmation"];

function ageMs(nowIso: string, updatedAtIso: string): number {
  return (Date.parse(nowIso) || 0) - (Date.parse(updatedAtIso) || 0);
}

function threadOf(session: PoSession): ThreadRef {
  return { threadId: session.threadId, to: session.buyer?.email, subject: "Re: your purchase order" };
}

export async function sweepLifecycle(deps: LifecycleDeps): Promise<SweepResult> {
  const now = deps.now();
  const reminded: string[] = [];
  const expired: string[] = [];

  const ids = await deps.store.listQueue("awaiting", 500);
  for (const id of ids) {
    const session = await deps.store.loadSession(id).catch(() => null);
    if (!session || !WAITING_STATES.includes(session.state)) {
      await deps.store.dequeue("awaiting", id);
      continue;
    }

    const age = ageMs(now, session.updatedAt);

    if (age >= deps.config.sessionExpiryDays * DAY_MS) {
      await deps.channel.sendReply(threadOf(session), { subject: "Re: your purchase order", text: draftExpiry() });
      session.state = "expired";
      session.updatedAt = now;
      session.audit.push({ at: now, event: "expired" });
      await deps.store.saveSession(session);
      await deps.store.dequeue("awaiting", id);
      expired.push(id);
      continue;
    }

    if (!session.remindedAt && age >= deps.config.reminderDays * DAY_MS) {
      await deps.channel.sendReply(threadOf(session), {
        subject: "Re: your purchase order",
        text: draftNudge(session.validation ?? []),
      });
      session.remindedAt = now;
      session.updatedAt = now;
      session.audit.push({ at: now, event: "reminded" });
      await deps.store.saveSession(session);
      reminded.push(id);
    }
  }

  return { reminded, expired };
}
