import { describe, it, expect, afterEach } from "vitest";
import { fanOutEscalation, escalationSummary } from "@/lib/po-agent/escalate";
import { getPoAgentConfig } from "@/lib/po-agent/config";
import { createPoStore } from "@/lib/po-agent/store";
import { createMockRedis } from "@/tests/helpers/mock-redis";
import { installMockFetch } from "@/tests/helpers/mock-fetch";
import type { PoSession } from "@/lib/po-agent/types";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const session: PoSession = {
  id: "google:t1",
  channel: "google",
  threadId: "t1",
  state: "escalated",
  clarificationRounds: 0,
  buyer: { email: "jane@acme.com", b2bUserId: 1, customerId: 42, companyId: 123, role: 1, companyName: "Acme" },
  audit: [],
  messageIds: [],
  createdAt: "2026-07-23T12:00:00.000Z",
  updatedAt: "2026-07-23T12:00:00.000Z",
};

const now = () => "2026-07-23T12:00:00.000Z";

describe("escalation fan-out toggles", () => {
  it("queue only when no email/slack configured", async () => {
    const store = createPoStore(createMockRedis());
    const notified = await fanOutEscalation({ config: getPoAgentConfig({}), store, now }, session, ["company_not_approved"]);
    expect(notified).toEqual(["queue"]);
    expect(await store.listQueue("escalated")).toContain("google:t1");
  });

  it("adds slack when a webhook is configured", async () => {
    installMockFetch([{ url: "https://hooks.slack", body: "ok" }]);
    const store = createPoStore(createMockRedis());
    const config = getPoAgentConfig({ PO_AGENT_SLACK_WEBHOOK_URL: "https://hooks.slack/xyz" });
    const notified = await fanOutEscalation({ config, store, now }, session, ["price_dispute"]);
    expect(notified).toEqual(["queue", "slack"]);
  });

  it("adds email when an address and mailer are provided", async () => {
    const store = createPoStore(createMockRedis());
    const sent: Array<{ to: string; subject: string }> = [];
    const config = getPoAgentConfig({ PO_AGENT_ESCALATION_EMAIL: "reps@silk.com" });
    const notified = await fanOutEscalation(
      {
        config,
        store,
        now,
        sendMail: async (to, subject) => {
          sent.push({ to, subject });
          return true;
        },
      },
      session,
      ["credit_hold"],
    );
    expect(notified).toEqual(["queue", "email"]);
    expect(sent[0].to).toBe("reps@silk.com");
    expect(sent[0].subject).toContain("Acme");
  });

  it("summary includes company, reasons, and session id", () => {
    const s = escalationSummary(session, ["company_not_approved"]);
    expect(s).toContain("Acme");
    expect(s).toContain("company_not_approved");
    expect(s).toContain("google:t1");
  });
});
