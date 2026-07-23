import { describe, it, expect } from "vitest";
import { computeMetrics, currentYyyymm } from "@/lib/po-agent/metrics";
import { isStaffAuthorized, safeEqual } from "@/lib/po-agent/staff-auth";
import { createPoStore } from "@/lib/po-agent/store";
import { createMockRedis } from "@/tests/helpers/mock-redis";

describe("computeMetrics", () => {
  it("derives touchless rate and value", () => {
    const m = computeMetrics({ received: 10, orders: 6, quotes: 2, escalations: 2, valueCents: 12345 });
    expect(m.touchless).toBe(8);
    expect(m.touchlessRate).toBeCloseTo(0.8, 5);
    expect(m.valueProcessed).toBe(123.45);
  });
  it("handles empty counters", () => {
    const m = computeMetrics({});
    expect(m.touchlessRate).toBe(0);
    expect(m.received).toBe(0);
  });
  it("currentYyyymm", () => {
    expect(currentYyyymm("2026-07-23T12:00:00.000Z")).toBe("202607");
  });
});

describe("isStaffAuthorized", () => {
  it("token / cookie / basic auth against the secret", () => {
    expect(isStaffAuthorized({ token: "s3cret" }, "s3cret", false)).toBe(true);
    expect(isStaffAuthorized({ cookie: "s3cret" }, "s3cret", false)).toBe(true);
    // Basic base64("admin:s3cret")
    const basic = Buffer.from("admin:s3cret").toString("base64");
    expect(isStaffAuthorized({ basic }, "s3cret", false)).toBe(true);
    expect(isStaffAuthorized({ token: "nope" }, "s3cret", false)).toBe(false);
  });
  it("open in dev when no secret; closed in prod", () => {
    expect(isStaffAuthorized({}, undefined, true)).toBe(true);
    expect(isStaffAuthorized({}, undefined, false)).toBe(false);
  });
  it("safeEqual is length-aware", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "ab")).toBe(false);
  });
});

describe("store metrics helpers", () => {
  it("getCounters parses the HGETALL hash; loadSessions filters missing", async () => {
    const store = createPoStore(createMockRedis());
    await store.bumpCounter("202607", "orders", 3);
    await store.bumpCounter("202607", "valueCents", 5000);
    expect(await store.getCounters("202607")).toEqual({ orders: 3, valueCents: 5000 });

    await store.saveSession({
      id: "simulator:t1",
      channel: "simulator",
      threadId: "t1",
      state: "escalated",
      clarificationRounds: 0,
      audit: [],
      messageIds: [],
      createdAt: "2026-07-23T12:00:00.000Z",
      updatedAt: "2026-07-23T12:00:00.000Z",
    });
    const sessions = await store.loadSessions(["simulator:t1", "simulator:missing"]);
    expect(sessions.map((s) => s.id)).toEqual(["simulator:t1"]);
  });
});
