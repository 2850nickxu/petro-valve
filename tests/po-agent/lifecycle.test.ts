import { describe, it, expect } from "vitest";
import { sweepLifecycle } from "@/lib/po-agent/lifecycle";
import { SimulatorChannel } from "@/lib/po-agent/channel/simulator";
import { getPoAgentConfig } from "@/lib/po-agent/config";
import { createPoStore } from "@/lib/po-agent/store";
import { createMockRedis } from "@/tests/helpers/mock-redis";
import type { PoSession } from "@/lib/po-agent/types";

const NOW = "2026-07-23T12:00:00.000Z";

function waiting(id: string, updatedAt: string, remindedAt?: string): PoSession {
  return {
    id,
    channel: "simulator",
    threadId: id.split(":")[1],
    state: "clarifying",
    clarificationRounds: 1,
    remindedAt,
    validation: [{ kind: "line_unresolved", message: "We couldn't match this item.", blocking: true }],
    audit: [],
    messageIds: [],
    createdAt: updatedAt,
    updatedAt,
  };
}

describe("sweepLifecycle", () => {
  it("nudges after N days of silence and expires after M", async () => {
    const store = createPoStore(createMockRedis());
    const channel = new SimulatorChannel();
    const config = getPoAgentConfig({}); // reminder 3d, expiry 10d

    const toNudge = waiting("simulator:nudge", "2026-07-19T12:00:00.000Z"); // 4 days ago
    const toExpire = waiting("simulator:expire", "2026-07-10T12:00:00.000Z"); // 13 days ago
    const fresh = waiting("simulator:fresh", "2026-07-23T06:00:00.000Z"); // 6 hours ago

    for (const s of [toNudge, toExpire, fresh]) {
      await store.saveSession(s);
      await store.enqueue("awaiting", s.id, 0);
    }

    const result = await sweepLifecycle({ config, store, channel, now: () => NOW });

    expect(result.reminded).toEqual(["simulator:nudge"]);
    expect(result.expired).toEqual(["simulator:expire"]);
    expect(channel.sent).toHaveLength(2);

    const nudged = await store.loadSession("simulator:nudge");
    expect(nudged?.remindedAt).toBe(NOW);
    const expired = await store.loadSession("simulator:expire");
    expect(expired?.state).toBe("expired");
    // expired session is removed from the awaiting queue
    expect(await store.listQueue("awaiting")).not.toContain("simulator:expire");
  });

  it("does not nudge twice", async () => {
    const store = createPoStore(createMockRedis());
    const channel = new SimulatorChannel();
    const already = waiting("simulator:done", "2026-07-19T12:00:00.000Z", "2026-07-20T12:00:00.000Z");
    await store.saveSession(already);
    await store.enqueue("awaiting", already.id, 0);

    const result = await sweepLifecycle({ config: getPoAgentConfig({}), store, channel, now: () => NOW });
    expect(result.reminded).toEqual([]);
    expect(channel.sent).toHaveLength(0);
  });
});

describe("sweepLifecycle — simulator sessions", () => {
  it("never nudges a simulator buyer through the real mailbox", async () => {
    const store = createPoStore(createMockRedis());
    const sends: unknown[] = [];
    const real = {
      ...new SimulatorChannel(),
      id: "google" as const,
      sendReply: async (...args: unknown[]) => {
        sends.push(args);
        return { messageId: "g1" };
      },
    } as unknown as SimulatorChannel;
    const s = waiting("simulator:sandbox", "2026-07-10T12:00:00.000Z");
    await store.saveSession(s);
    await store.enqueue("awaiting", s.id, 0);

    const result = await sweepLifecycle({ config: getPoAgentConfig({}), store, channel: real, now: () => NOW });

    expect(result).toEqual({ reminded: [], expired: [] });
    expect(sends).toHaveLength(0);
    expect(await store.listQueue("awaiting")).not.toContain("simulator:sandbox");
  });
});
