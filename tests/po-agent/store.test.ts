import { describe, it, expect } from "vitest";
import { createPoStore, keys, sessionId } from "@/lib/po-agent/store";
import { createMockRedis } from "@/tests/helpers/mock-redis";
import type { PoSession } from "@/lib/po-agent/types";

function newSession(id: string): PoSession {
  const now = "2026-07-23T12:00:00.000Z";
  return {
    id,
    channel: "simulator",
    threadId: id.split(":")[1] ?? id,
    state: "new",
    clarificationRounds: 0,
    audit: [],
    messageIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

describe("key helpers", () => {
  it("namespaces everything under poa:", () => {
    expect(keys.session("google:abc")).toBe("poa:session:google:abc");
    expect(keys.msg("google", "m1")).toBe("poa:msg:google:m1");
    expect(keys.lock("s1")).toBe("poa:lock:s1");
    expect(keys.trusted("Buyer@Acme.com")).toBe("poa:trusted:buyer@acme.com");
    expect(sessionId("google", "t9")).toBe("google:t9");
  });
});

describe("message dedupe (claimMessage)", () => {
  it("claims once, then reports duplicate", async () => {
    const store = createPoStore(createMockRedis());
    expect(await store.claimMessage("google", "msg-1")).toBe(true);
    expect(await store.claimMessage("google", "msg-1")).toBe(false);
    expect(await store.claimMessage("google", "msg-2")).toBe(true);
  });
});

describe("submission locks", () => {
  it("acquires exclusively, releases, re-acquires", async () => {
    const store = createPoStore(createMockRedis());
    expect(await store.acquireLock("simulator:t1")).toBe(true);
    expect(await store.acquireLock("simulator:t1")).toBe(false);
    await store.releaseLock("simulator:t1");
    expect(await store.acquireLock("simulator:t1")).toBe(true);
  });
});

describe("session persistence", () => {
  it("round-trips a session and indexes it in the recent queue", async () => {
    const redis = createMockRedis();
    const store = createPoStore(redis);
    const s = newSession("simulator:t42");
    await store.saveSession(s);

    const loaded = await store.loadSession("simulator:t42");
    expect(loaded).toEqual(s);
    expect(await store.listQueue("recent")).toContain("simulator:t42");
    expect(await store.loadSession("simulator:missing")).toBeNull();
  });
});

describe("trusted senders", () => {
  it("is false until set, then true (case-insensitive)", async () => {
    const store = createPoStore(createMockRedis());
    expect(await store.isTrusted("Buyer@Acme.com")).toBe(false);
    await store.setTrusted("buyer@acme.com");
    expect(await store.isTrusted("BUYER@ACME.COM")).toBe(true);
  });
});

describe("queues and counters", () => {
  it("enqueues/dequeues escalated and lists REV by score", async () => {
    const store = createPoStore(createMockRedis());
    await store.enqueue("escalated", "s1", 100);
    await store.enqueue("escalated", "s2", 200);
    expect(await store.listQueue("escalated")).toEqual(["s2", "s1"]);
    await store.dequeue("escalated", "s2");
    expect(await store.listQueue("escalated")).toEqual(["s1"]);
  });

  it("drops a session from the escalated queue once it's saved in any other state", async () => {
    const store = createPoStore(createMockRedis());
    const s = { ...newSession("simulator:t1"), state: "escalated" as const };
    await store.enqueue("escalated", s.id, 100);
    await store.saveSession(s);
    expect(await store.listQueue("escalated")).toEqual([s.id]);

    await store.saveSession({ ...s, state: "clarifying" }); // e.g. resolved by a buyer reply
    expect(await store.listQueue("escalated")).toEqual([]);
  });

  it("bumps monthly counters and daily caps", async () => {
    const store = createPoStore(createMockRedis());
    expect(await store.bumpCounter("202607", "orders")).toBe(1);
    expect(await store.bumpCounter("202607", "orders")).toBe(2);
    expect(await store.bumpDailyCap("20260723", "submits", 5)).toBe(5);
  });
});
