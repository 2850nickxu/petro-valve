import { describe, it, expect } from "vitest";
import { adminStatus, isOperational } from "@/lib/po-agent/admin-status";

describe("adminStatus", () => {
  it("reports an empty/unconfigured environment", () => {
    const s = adminStatus({});
    expect(s.enabled).toBe(false);
    expect(s.store.configured).toBe(false);
    expect(s.redis).toBe(false);
    expect(s.ai.configured).toBe(false);
    expect(s.channelCreds.google).toBe(false);
    expect(isOperational(s)).toBe(false);
  });

  it("reflects a fully-configured Gmail deployment", () => {
    const s = adminStatus({
      PO_AGENT_ENABLED: "true",
      BIGCOMMERCE_STORE_HASH: "abc",
      BIGCOMMERCE_ACCESS_TOKEN: "tok",
      BIGCOMMERCE_CHANNEL_ID: "1",
      UPSTASH_REDIS_REST_URL: "https://x",
      UPSTASH_REDIS_REST_TOKEN: "t",
      PO_AGENT_MODEL: "anthropic:claude-sonnet-4-6",
      ANTHROPIC_API_KEY: "sk-x",
      GOOGLE_PO_CLIENT_ID: "c",
      GOOGLE_PO_CLIENT_SECRET: "s",
      GOOGLE_PO_REFRESH_TOKEN: "r",
      PO_AGENT_SLACK_WEBHOOK_URL: "https://hooks",
      PO_AGENT_STAFF_SECRET: "gate",
    });
    expect(s.store).toMatchObject({ configured: true, storeHash: "abc", channelId: 1 });
    expect(s.redis).toBe(true);
    expect(s.ai).toMatchObject({ configured: true, model: "anthropic:claude-sonnet-4-6" });
    expect(s.channelCreds.google).toBe(true);
    expect(s.escalation.slack).toBe(true);
    expect(s.staffGate).toBe(true);
    expect(isOperational(s)).toBe(true);
  });
});
