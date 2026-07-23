// Redis persistence for the PO agent: sessions, message dedupe, submission locks,
// Gmail history watermark, review-queue indexes, counters, trusted senders.
//
// All keys are namespaced `poa:`. The store is built over the generic Redis client
// (lib/redis.ts) and is injected, so tests use an in-memory mock and the agent fails
// closed (requireRedis throws) when Redis is unconfigured but the feature is enabled.

import { getRedis, type Redis } from "@/lib/redis";
import type { PoSession } from "./types";

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
  counters: (yyyymm: string) => `poa:counters:${yyyymm}`,
  caps: (yyyymmdd: string) => `poa:caps:${yyyymmdd}`,
  trusted: (email: string) => `poa:trusted:${email.toLowerCase()}`,
} as const;

/** Compose a session id from channel + thread id. */
export function sessionId(channel: string, threadId: string): string {
  return `${channel}:${threadId}`;
}

export interface PoStore {
  /** Claim a message for processing. True ⇒ newly claimed; false ⇒ already seen (skip). */
  claimMessage(channel: string, messageId: string): Promise<boolean>;
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
      await redis.pipeline([
        ["SET", keys.session(session.id), JSON.stringify(session), "EX", String(SESSION_TTL_SEC)],
        ["ZADD", keys.queueRecent, String(recentScore), session.id],
      ]);
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
