import { describe, it, expect, afterEach } from "vitest";
import { processInbound, type PipelineDeps } from "@/lib/po-agent/pipeline";
import { SimulatorChannel } from "@/lib/po-agent/channel/simulator";
import { resolveExtractor } from "@/lib/po-agent/ai/extractor";
import { getPoAgentConfig } from "@/lib/po-agent/config";
import { createPoStore } from "@/lib/po-agent/store";
import { createMockRedis } from "@/tests/helpers/mock-redis";
import { installMockFetch, TEST_CTX, type MockRoute } from "@/tests/helpers/mock-fetch";
import { termsReads } from "@/tests/helpers/bc-fixtures";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const NOW = "2026-07-23T12:00:00.000Z";

// Stated $5.00 is well below the WIDGET-100 contract price of $9.84 (termsReads).
const BELOW_PO = `PO Number: PO-5567
Please pay on account, net 30.
SKU: WIDGET-100 Qty: 10 $5.00`;

// Recipient routes must precede the generic /companies/123 route (first match wins).
const recipientRoutes: MockRoute[] = [
  { url: "/companies/123/super-admins", body: { code: 200, data: [{ id: 1, firstName: "Sam", email: "sam@rep.com" }] } },
  { url: "/users?companyId=123&roles=0", body: { code: 200, data: [{ id: 9, firstName: "Ada", email: "ada@acme.com", role: "0" }] } },
];

function deps(over: Partial<PipelineDeps> = {}): PipelineDeps {
  return {
    ctx: TEST_CTX,
    config: getPoAgentConfig({ PO_AGENT_FORWARD_PRICE_MISMATCH: "true", PO_AGENT_MAX_CLARIFICATIONS: "0", PO_AGENT_FIRST_ORDER_CONFIRM: "false" }),
    store: createPoStore(createMockRedis()),
    channel: new SimulatorChannel(),
    extract: resolveExtractor({}),
    now: () => NOW,
    ...over,
  };
}

describe("below-contract forward on escalation", () => {
  it("forwards the PO to sales rep + admin when a below-contract price mismatch escalates", async () => {
    installMockFetch([...recipientRoutes, ...termsReads()]);
    const channel = new SimulatorChannel();
    const session = await processInbound(deps({ channel }), channel.inject({ from: "buyer@acme.com", subject: "PO 5567", bodyText: BELOW_PO }), {});

    expect(session.state).toBe("escalated");
    expect(session.validation?.some((v) => v.kind === "price_mismatch")).toBe(true);
    expect(session.escalation?.forwarded?.sort()).toEqual(["ada@acme.com", "sam@rep.com"]);
    // the forward went out via the channel as a captured email
    expect(channel.sent.some((c) => /below-contract/i.test(c.reply.subject ?? ""))).toBe(true);
  });

  it("does not forward when the toggle is off", async () => {
    installMockFetch([...recipientRoutes, ...termsReads()]);
    const channel = new SimulatorChannel();
    const d = deps({ channel, config: getPoAgentConfig({ PO_AGENT_MAX_CLARIFICATIONS: "0", PO_AGENT_FIRST_ORDER_CONFIRM: "false" }) });
    const session = await processInbound(d, channel.inject({ from: "buyer@acme.com", subject: "PO 5567", bodyText: BELOW_PO }), {});

    expect(session.state).toBe("escalated");
    expect(session.escalation?.forwarded).toBeUndefined();
  });
});
