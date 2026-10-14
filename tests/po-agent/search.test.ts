import { describe, it, expect } from "vitest";
import { createPoStore } from "@/lib/po-agent/store";
import { createMockRedis } from "@/tests/helpers/mock-redis";
import type { PoSession } from "@/lib/po-agent/types";
import { SUMMARY_VERSION } from "@/lib/po-agent/session-summary";

// searchSessions prunes summaries older than its 30-day TTL window, measured against the
// real Date.now(). Fixtures MUST therefore be anchored near "now" — absolute past dates are
// a time-bomb that starts failing once wall-clock time moves past them. Anchor a few days
// back, in ascending order, comfortably inside the window.
const DAY = 86_400_000;
const BASE = Date.now() - 5 * DAY;
const iso = (offsetDays: number) => new Date(BASE + offsetDays * DAY).toISOString();

function makeSession(overrides: Partial<PoSession> & { id: string }): PoSession {
  return {
    channel: "simulator",
    threadId: overrides.id.split(":")[1] ?? overrides.id,
    state: "completed_order",
    clarificationRounds: 0,
    audit: [],
    messageIds: [],
    createdAt: overrides.updatedAt ?? iso(0),
    updatedAt: iso(0),
    ...overrides,
  } as PoSession;
}

// Four test sessions with different companies / emails / PONs / states / timestamps.
const SESSION_A = makeSession({
  id: "simulator:t1",
  buyer: { email: "alice@acme.com", companyName: "Acme Corp", b2bUserId: 1, customerId: 10, companyId: 100, role: 1, companyRoleName: "Buyer" },
  extracted: { poNumber: "PO-1001", lines: [], paymentIntent: "on_account", requestedShipDate: null, shipTo: null, billTo: null, currency: null, confidence: "high", buyerNote: null },
  state: "completed_order",
  decision: { kind: "order", reasons: [] },
  updatedAt: iso(0),
  createdAt: iso(0),
});

const SESSION_B = makeSession({
  id: "simulator:t2",
  buyer: { email: "bob@beta.io", companyName: "Beta Industries", b2bUserId: 2, customerId: 20, companyId: 200, role: 1 },
  extracted: { poNumber: "PO-2002", lines: [], paymentIntent: "on_account", requestedShipDate: null, shipTo: null, billTo: null, currency: null, confidence: "medium", buyerNote: null },
  state: "completed_quote",
  decision: { kind: "quote", reasons: [] },
  updatedAt: iso(1),
  createdAt: iso(1),
});

const SESSION_C = makeSession({
  id: "simulator:t3",
  buyer: { email: "carol@gamma.net", companyName: "Gamma LLC", b2bUserId: 3, customerId: 30, companyId: 300, role: 1 },
  extracted: { poNumber: "PO-3003", lines: [], paymentIntent: "on_account", requestedShipDate: null, shipTo: null, billTo: null, currency: null, confidence: "low", buyerNote: null },
  state: "escalated",
  decision: { kind: "escalate", reasons: [] },
  updatedAt: iso(2),
  createdAt: iso(2),
});

const SESSION_D = makeSession({
  id: "simulator:t4",
  buyer: { email: "dave@delta.com", companyName: "Delta Corp", b2bUserId: 4, customerId: 40, companyId: 400, role: 1 },
  extracted: { poNumber: "PO-4004", lines: [], paymentIntent: "on_account", requestedShipDate: null, shipTo: null, billTo: null, currency: null, confidence: "high", buyerNote: null },
  state: "rejected",
  decision: { kind: "reject", reasons: [] },
  updatedAt: iso(3),
  createdAt: iso(3),
});

async function seedStore() {
  const redis = createMockRedis();
  const store = createPoStore(redis);
  for (const s of [SESSION_A, SESSION_B, SESSION_C, SESSION_D]) {
    await store.saveSession(s);
  }
  return store;
}

describe("searchSessions — text search", () => {
  it("matches by company name substring (case-insensitive)", async () => {
    const store = await seedStore();
    const { items, total } = await store.searchSessions({ text: "acme" });
    expect(total).toBe(1);
    expect(items[0].id).toBe("simulator:t1");
  });

  it("matches by buyer email substring", async () => {
    const store = await seedStore();
    const { items, total } = await store.searchSessions({ text: "beta.io" });
    expect(total).toBe(1);
    expect(items[0].id).toBe("simulator:t2");
  });

  it("matches by PO number substring", async () => {
    const store = await seedStore();
    const { items, total } = await store.searchSessions({ text: "PO-3003" });
    expect(total).toBe(1);
    expect(items[0].id).toBe("simulator:t3");
  });

  it("is case-insensitive for company match", async () => {
    const store = await seedStore();
    const { items } = await store.searchSessions({ text: "GAMMA" });
    expect(items[0].company).toBe("Gamma LLC");
  });

  it("returns all sessions when text is empty", async () => {
    const store = await seedStore();
    const { total } = await store.searchSessions({});
    expect(total).toBe(4);
  });

  it("returns empty when no match", async () => {
    const store = await seedStore();
    const { total, items } = await store.searchSessions({ text: "nonexistent-xyz" });
    expect(total).toBe(0);
    expect(items).toHaveLength(0);
  });
});

describe("searchSessions — state filter", () => {
  it("filters by exact state", async () => {
    const store = await seedStore();
    const { items, total } = await store.searchSessions({ state: "completed_quote" });
    expect(total).toBe(1);
    expect(items[0].id).toBe("simulator:t2");
  });

  it("returns all matching state across multiple sessions", async () => {
    const store = await seedStore();
    // Only one escalated session in seed data.
    const { total } = await store.searchSessions({ state: "escalated" });
    expect(total).toBe(1);
  });

  it("combines text and state filter", async () => {
    const store = await seedStore();
    // Both text matches "corp" (Acme Corp + Delta Corp) but only rejected state.
    const { items, total } = await store.searchSessions({ text: "corp", state: "rejected" });
    expect(total).toBe(1);
    expect(items[0].id).toBe("simulator:t4");
  });
});

describe("searchSessions — sorting and pagination", () => {
  it("sorts by updatedAt descending", async () => {
    const store = await seedStore();
    const { items } = await store.searchSessions({});
    // SESSION_D has the most recent updatedAt, SESSION_A the oldest.
    expect(items[0].id).toBe("simulator:t4");
    expect(items[1].id).toBe("simulator:t3");
    expect(items[2].id).toBe("simulator:t2");
    expect(items[3].id).toBe("simulator:t1");
  });

  it("respects offset and limit", async () => {
    const store = await seedStore();
    const { items, total } = await store.searchSessions({ offset: 1, limit: 2 });
    expect(total).toBe(4);
    expect(items).toHaveLength(2);
    // Page 1 offset 1: second and third most recent (SESSION_C, SESSION_B).
    expect(items[0].id).toBe("simulator:t3");
    expect(items[1].id).toBe("simulator:t2");
  });

  it("returns empty items when offset exceeds total", async () => {
    const store = await seedStore();
    const { items, total } = await store.searchSessions({ offset: 100, limit: 25 });
    expect(total).toBe(4);
    expect(items).toHaveLength(0);
  });

  it("limit of 1 returns only the first (most recent) result", async () => {
    const store = await seedStore();
    const { items, total } = await store.searchSessions({ limit: 1 });
    expect(total).toBe(4);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("simulator:t4");
  });
});

describe("searchSessions — from/to bounds", () => {
  it("filters by from timestamp (inclusive)", async () => {
    const store = await seedStore();
    // Only SESSION_C and SESSION_D are on or after C's timestamp (inclusive).
    const from = Date.parse(iso(2));
    const { total } = await store.searchSessions({ from });
    expect(total).toBe(2);
  });

  it("filters by to timestamp (inclusive)", async () => {
    const store = await seedStore();
    // Only SESSION_A is on or before its own timestamp (inclusive).
    const to = Date.parse(iso(0));
    const { total } = await store.searchSessions({ to });
    expect(total).toBe(1);
  });
});

describe("searchSessions — summary index", () => {
  it("saveSession populates the search index", async () => {
    const redis = createMockRedis();
    const store = createPoStore(redis);
    await store.saveSession(SESSION_A);

    const { items } = await store.searchSessions({ text: "Acme" });
    expect(items).toHaveLength(1);
    expect(items[0].company).toBe("Acme Corp");
    expect(items[0].email).toBe("alice@acme.com");
    expect(items[0].poNumber).toBe("PO-1001");
    expect(items[0].state).toBe("completed_order");
    expect(items[0].decision).toBe("order");
  });

  it("overwriting a session updates the index", async () => {
    const redis = createMockRedis();
    const store = createPoStore(redis);
    await store.saveSession(SESSION_A);

    const updated = { ...SESSION_A, state: "escalated" as const, updatedAt: iso(4) };
    await store.saveSession(updated);

    const { items } = await store.searchSessions({ text: "acme" });
    expect(items[0].state).toBe("escalated");
  });
});

describe("searchSessions — Sessions list support", () => {
  it("counts matches per state, ignoring the state filter, for the tab counts", async () => {
    const store = await seedStore();
    const all = await store.searchSessions({});
    expect(all.counts).toEqual({ completed_order: 1, completed_quote: 1, escalated: 1, rejected: 1 });

    const escalated = await store.searchSessions({ state: "escalated" });
    expect(escalated.total).toBe(1);
    expect(escalated.counts).toEqual(all.counts);

    const acme = await store.searchSessions({ text: "acme" });
    expect(acme.counts).toEqual({ completed_order: 1 });
  });

  it("finds a session by a SKU on its PO", async () => {
    const redis = createMockRedis();
    const store = createPoStore(redis);
    await store.saveSession(
      makeSession({
        id: "simulator:sku",
        resolution: [
          { line: { rawText: "x", sku: "ANS-GLV-NIT-XL", description: null, quantity: 5, statedUnitPrice: null, statedTotal: null }, matchedSku: "ANS-GLV-NIT-XL", productId: 1, issues: [] },
        ],
      }),
    );
    const { items } = await store.searchSessions({ text: "glv-nit" });
    expect(items.map((s) => s.id)).toEqual(["simulator:sku"]);
  });

  it("rebuilds index rows written before the current summary format, and prunes rows whose session expired", async () => {
    const redis = createMockRedis();
    const store = createPoStore(redis);
    await store.saveSession(SESSION_C);

    // Simulate rows written by the old code: no version, no list fields.
    const oldRow = (s: PoSession) =>
      JSON.stringify({ id: s.id, company: s.buyer?.companyName ?? "", email: s.buyer?.email ?? "", poNumber: s.extracted?.poNumber ?? "", state: s.state, createdAt: s.createdAt, updatedAt: s.updatedAt });
    await redis.cmd(["HSET", "poa:index:search", SESSION_C.id, oldRow(SESSION_C), "simulator:gone", oldRow({ ...SESSION_A, id: "simulator:gone" })]);

    const { items, counts } = await store.searchSessions({});
    expect(items.map((s) => s.id)).toEqual([SESSION_C.id]); // the session-less row is dropped
    expect(counts).toEqual({ escalated: 1 });
    expect(items[0]).toMatchObject({ v: SUMMARY_VERSION, linesTotal: 0, messagesIn: 0, messagesOut: 0 });
    expect(items[0].why).toBeTruthy();

    // Written back, so the next search reads the new format straight from the index.
    const row = await redis.cmd<string[]>(["HGETALL", "poa:index:search"]);
    expect(row).toHaveLength(2);
    expect(JSON.parse(row[1])).toMatchObject({ id: SESSION_C.id, v: SUMMARY_VERSION });
  });
});
