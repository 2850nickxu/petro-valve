import { describe, it, expect } from "vitest";
import { parseTokenUsage, estimateCostUsd, usageTotals } from "@/lib/po-agent/token-usage";
import { createPoStore } from "@/lib/po-agent/store";
import { createMockRedis } from "@/tests/helpers/mock-redis";

describe("estimateCostUsd", () => {
  it("prices a known model and skips unknown ones", () => {
    // 1M input @ $3 + 1M output @ $15 for a sonnet model
    expect(estimateCostUsd("anthropic:claude-sonnet-4-6", 1_000_000, 1_000_000)).toBeCloseTo(18, 5);
    expect(estimateCostUsd("acme:mystery-model", 1000, 1000)).toBeUndefined();
  });
});

describe("parseTokenUsage + usageTotals", () => {
  it("aggregates per model and totals, sorted by total desc", () => {
    const rows = parseTokenUsage({
      "anthropic:claude-sonnet-4-6|in": 200,
      "anthropic:claude-sonnet-4-6|out": 100,
      "anthropic:claude-sonnet-4-6|calls": 2,
      "openai:gpt-4o|in": 10,
      "openai:gpt-4o|out": 5,
      "openai:gpt-4o|calls": 1,
    });
    expect(rows[0].model).toBe("anthropic:claude-sonnet-4-6"); // higher total first
    expect(rows[0]).toMatchObject({ input: 200, output: 100, total: 300, calls: 2 });
    const t = usageTotals(rows);
    expect(t).toMatchObject({ input: 210, output: 105, total: 315, calls: 3, costKnown: true });
    expect(t.costUsd).toBeGreaterThan(0);
  });
});

describe("store token recording", () => {
  it("accumulates HINCRBY counters and reads them back", async () => {
    const store = createPoStore(createMockRedis());
    const model = "anthropic:claude-sonnet-4-6";
    await store.recordTokens("202607", model, 100, 50);
    await store.recordTokens("202607", model, 100, 50);
    const usage = await store.getTokenUsage("202607");
    expect(usage[`${model}|in`]).toBe(200);
    expect(usage[`${model}|out`]).toBe(100);
    expect(usage[`${model}|calls`]).toBe(2);
    expect(parseTokenUsage(usage)[0]).toMatchObject({ total: 300, calls: 2 });
  });
});
