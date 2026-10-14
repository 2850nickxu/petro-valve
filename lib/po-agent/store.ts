// Redis persistence for the PO agent: sessions, message dedupe, submission locks,
// Gmail history watermark, review-queue indexes, counters, trusted senders.
//
// All keys are namespaced `poa:`. The store is built over the generic Redis client
// (lib/redis.ts) and is injected, so tests use an in-memory mock and the agent fails
// closed (requireRedis throws) when Redis is unconfigured but the feature is enabled.

import { getRedis, type Redis } from "@/lib/redis";
import type { PoSession, PoSessionState, SessionSummary } from "./types";
import { SUMMARY_VERSION, summaryOf } from "./session-summary";

const SESSION_TTL_SEC = 60 * 60 * 24 * 30; // 30 days
const MSG_TTL_SEC = 60 * 60 * 24 * 14; // 14 days

export const keys = {
  session: (id: string) => `poa:session:${id}`,
  msg: (channel: string, messageId: string) => `poa:msg:${channel}:${messageId}`,
  lock: (id: string) => `poa:lock:${id}`,
  gmailHistoryId: "poa:gmail:historyId",
  gmailLastPushAt: "poa:gmail:lastPushAt",
  queueEscalated: "poa:queue:escalated",
  queueRecent: "poa:queue:recent",
  queueAwaiting: "poa:queue:awaiting",
  indexSearch: "poa:index:search",
  counters: (yyyymm: string) => `poa:counters:${yyyymm}`,
  tokens: (yyyymm: string) => `poa:tokens:${yyyymm}`,
  caps: (yyyymmdd: string) => `poa:caps:${yyyymmdd}`,
  trusted: (email: string) => `poa:trusted:${email.toLowerCase()}`,
} as const;

/** Compose a session id from channel + thread id. */
export function sessionId(channel: string, threadId: string): string {
  return `${channel}:${threadId}`;
}

export interface SessionSearchQuery {
  text?: string;
  state?: PoSessionState;
  from?: number;
  to?: number;
  offset?: number;
  limit?: number;
}

export interface SessionSearchResult {
  /** Matches for the whole query, before paging. */
  total: number;
  items: SessionSummary[];
  /** Matches per state for the same text and date filters, ignoring `state` — tab counts. */
  counts: Partial<Record<PoSessionState, number>>;
}

/** How many sessions to re-summarise per Redis round trip when back-filling. */
const BACKFILL_BATCH = 100;

export interface PoStore {
  /** Claim a message for processing. True ⇒ newly claimed; false ⇒ already seen (skip). */
  claimMessage(channel: string, messageId: string): Promise<boolean>;
  /** Undo a claim for a message that couldn't be processed, so a later delivery isn't skipped. */
  releaseMessage(channel: string, messageId: string): Promise<void>;
  /** Acquire a short-lived submission lock. True ⇒ acquired; false ⇒ held elsewhere. */
  acquireLock(id: string, ttlSec?: number): Promise<boolean>;
  releaseLock(id: string): Promise<void>;
  saveSession(session: PoSession): Promise<void>;
  loadSession(id: string): Promise<PoSession | null>;
  setGmailWatermark(historyId: string): Promise<void>;
  getGmailWatermark(): Promise<string | null>;
  setLastPushAt(iso: string): Promise<void>;
  getLastPushAt(): Promise<string | null>;
  isTrusted(email: string): Promise<boolean>;
  setTrusted(email: string): Promise<void>;
  enqueue(queue: "escalated" | "recent" | "awaiting", id: string, score: number): Promise<void>;
  dequeue(queue: "escalated" | "recent" | "awaiting", id: string): Promise<void>;
  listQueue(queue: "escalated" | "recent" | "awaiting", limit?: number): Promise<string[]>;
  bumpCounter(yyyymm: string, field: string, by?: number): Promise<number>;
  bumpDailyCap(yyyymmdd: string, field: string, by?: number): Promise<number>;
  getCounters(yyyymm: string): Promise<Record<string, number>>;
  loadSessions(ids: string[]): Promise<PoSession[]>;
  recordTokens(yyyymm: string, model: string, input: number, output: number): Promise<void>;
  getTokenUsage(yyyymm: string): Promise<Record<string, number>>;
  searchSessions(query: SessionSearchQuery): Promise<SessionSearchResult>;
}

function queueKey(queue: "escalated" | "recent" | "awaiting"): string {
  return queue === "escalated"
    ? keys.queueEscalated
    : queue === "recent"
      ? keys.queueRecent
      : keys.queueAwaiting;
}

export function createPoStore(redis: Redis): PoStore {
  return {
    async claimMessage(channel, messageId) {
      const r = await redis.cmd<string | null>([
        "SET",
        keys.msg(channel, messageId),
        "1",
        "NX",
        "EX",
        String(MSG_TTL_SEC),
      ]);
      return r === "OK";
    },

    async releaseMessage(channel, messageId) {
      await redis.cmd(["DEL", keys.msg(channel, messageId)]);
    },

    async acquireLock(id, ttlSec = 300) {
      const r = await redis.cmd<string | null>([
        "SET",
        keys.lock(id),
        "1",
        "NX",
        "EX",
        String(ttlSec),
      ]);
      return r === "OK";
    },

    async releaseLock(id) {
      await redis.cmd(["DEL", keys.lock(id)]);
    },

    async saveSession(session) {
      const recentScore = Date.parse(session.updatedAt) || 0;
      const cmds: string[][] = [
        ["SET", keys.session(session.id), JSON.stringify(session), "EX", String(SESSION_TTL_SEC)],
        ["ZADD", keys.queueRecent, String(recentScore), session.id],
        ["HSET", keys.indexSearch, session.id, JSON.stringify(summaryOf(session))],
      ];
      // Escalation adds a session to the review queue; leaving `escalated` by ANY path — a
      // buyer reply, a reprocess, a staff action — takes it off, so the queue never lists
      // sessions that no longer need review.
      if (session.state !== "escalated") cmds.push(["ZREM", keys.queueEscalated, session.id]);
      await redis.pipeline(cmds);
    },

    async loadSession(id) {
      const raw = await redis.cmd<string | null>(["GET", keys.session(id)]);
      return raw ? (JSON.parse(raw) as PoSession) : null;
    },

    async setGmailWatermark(historyId) {
      await redis.cmd(["SET", keys.gmailHistoryId, historyId]);
    },
    async getGmailWatermark() {
      return await redis.cmd<string | null>(["GET", keys.gmailHistoryId]);
    },

    async setLastPushAt(iso) {
      await redis.cmd(["SET", keys.gmailLastPushAt, iso]);
    },
    async getLastPushAt() {
      return await redis.cmd<string | null>(["GET", keys.gmailLastPushAt]);
    },

    async isTrusted(email) {
      const r = await redis.cmd<number>(["EXISTS", keys.trusted(email)]);
      return r === 1;
    },
    async setTrusted(email) {
      await redis.cmd(["SET", keys.trusted(email), "1"]);
    },

    async enqueue(queue, id, score) {
      await redis.cmd(["ZADD", queueKey(queue), String(score), id]);
    },
    async dequeue(queue, id) {
      await redis.cmd(["ZREM", queueKey(queue), id]);
    },
    async listQueue(queue, limit = 50) {
      // Highest score (most recent / most-recently-escalated) first.
      return await redis.cmd<string[]>(["ZRANGE", queueKey(queue), "0", String(limit - 1), "REV"]);
    },

    async bumpCounter(yyyymm, field, by = 1) {
      return await redis.cmd<number>(["HINCRBY", keys.counters(yyyymm), field, String(by)]);
    },
    async bumpDailyCap(yyyymmdd, field, by = 1) {
      return await redis.cmd<number>(["HINCRBY", keys.caps(yyyymmdd), field, String(by)]);
    },

    async getCounters(yyyymm) {
      const flat = await redis.cmd<string[]>(["HGETALL", keys.counters(yyyymm)]);
      const out: Record<string, number> = {};
      for (let i = 0; i + 1 < flat.length; i += 2) out[flat[i]] = Number(flat[i + 1]) || 0;
      return out;
    },

    async loadSessions(ids) {
      const sessions: PoSession[] = [];
      for (const id of ids) {
        const s = await this.loadSession(id);
        if (s) sessions.push(s);
      }
      return sessions;
    },

    async recordTokens(yyyymm, model, input, output) {
      await redis.pipeline([
        ["HINCRBY", keys.tokens(yyyymm), `${model}|in`, String(Math.max(0, Math.round(input)))],
        ["HINCRBY", keys.tokens(yyyymm), `${model}|out`, String(Math.max(0, Math.round(output)))],
        ["HINCRBY", keys.tokens(yyyymm), `${model}|calls`, "1"],
      ]);
    },

    async getTokenUsage(yyyymm) {
      const flat = await redis.cmd<string[]>(["HGETALL", keys.tokens(yyyymm)]);
      const out: Record<string, number> = {};
      for (let i = 0; i + 1 < flat.length; i += 2) out[flat[i]] = Number(flat[i + 1]) || 0;
      return out;
    },

    async searchSessions(query) {
      const flat = await redis.cmd<string[]>(["HGETALL", keys.indexSearch]);
      const cutoff = Date.now() - SESSION_TTL_SEC * 1000;

      let summaries: SessionSummary[] = [];
      const stale: string[] = [];

      for (let i = 0; i + 1 < flat.length; i += 2) {
        const id = flat[i];
        const raw = flat[i + 1];
        let summary: SessionSummary;
        try {
          summary = JSON.parse(raw) as SessionSummary;
        } catch {
          continue;
        }
        const updatedMs = Date.parse(summary.updatedAt);
        if (!Number.isFinite(updatedMs) || updatedMs < cutoff) {
          stale.push(id);
          continue;
        }
        summaries.push(summary);
      }

      // Index rows written before the current summary format are rebuilt from their
      // sessions once, so older sessions get the newer list columns without a migration.
      const outdated = summaries.filter((s) => (s.v ?? 1) < SUMMARY_VERSION);
      for (let i = 0; i < outdated.length; i += BACKFILL_BATCH) {
        const batch = outdated.slice(i, i + BACKFILL_BATCH);
        const raws = await redis.pipeline<string | null>(batch.map((s) => ["GET", keys.session(s.id)]));
        const fields: string[] = [];
        batch.forEach((old, j) => {
          const raw = raws[j];
          if (!raw) {
            stale.push(old.id); // the session itself expired: the row only leads to "not found"
            return;
          }
          try {
            const fresh = summaryOf(JSON.parse(raw) as PoSession);
            Object.assign(old, fresh);
            fields.push(fresh.id, JSON.stringify(fresh));
          } catch {
            /* unreadable session; keep the old row */
          }
        });
        if (fields.length) redis.cmd(["HSET", keys.indexSearch, ...fields]).catch(() => {});
      }
      if (stale.length) {
        const gone = new Set(stale);
        summaries = summaries.filter((s) => !gone.has(s.id));
      }

      // Best-effort pruning of stale entries.
      if (stale.length > 0) {
        redis.cmd(["HDEL", keys.indexSearch, ...stale]).catch(() => {});
        redis.cmd(["ZREM", keys.queueRecent, ...stale]).catch(() => {});
      }

      // Apply filters. Text and dates first, so the per-state counts describe what the
      // search would show under each tab.
      const text = query.text?.toLowerCase();
      const matching = summaries.filter((s) => {
        if (text) {
          const haystack = `${s.company} ${s.email} ${s.poNumber} ${(s.skus ?? []).join(" ")}`.toLowerCase();
          if (!haystack.includes(text)) return false;
        }
        const updatedMs = Date.parse(s.updatedAt);
        if (query.from !== undefined && updatedMs < query.from) return false;
        if (query.to !== undefined && updatedMs > query.to) return false;
        return true;
      });
      const counts: Partial<Record<PoSessionState, number>> = {};
      for (const s of matching) counts[s.state] = (counts[s.state] ?? 0) + 1;
      const filtered = query.state ? matching.filter((s) => s.state === query.state) : matching;

      // Sort by updatedAt descending.
      filtered.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

      const offset = query.offset ?? 0;
      const limit = query.limit ?? 25;
      return { total: filtered.length, items: filtered.slice(offset, offset + limit), counts };
    },
  };
}

/** Throws a clear error when Redis is required but unconfigured (fail closed). */
export function requireRedis(env: Record<string, string | undefined> = process.env): Redis {
  const r = getRedis(env);
  if (!r) {
    throw new Error(
      "PO agent requires Redis but UPSTASH_REDIS_REST_URL/TOKEN are not configured.",
    );
  }
  return r;
}

/** Convenience: a store bound to the env-configured Redis. */
export function poStore(env: Record<string, string | undefined> = process.env): PoStore {
  return createPoStore(requireRedis(env));
}
