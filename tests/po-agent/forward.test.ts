import { describe, it, expect, afterEach } from "vitest";
import { belowContractLines, forwardBelowContractPo, type ForwardDeps } from "@/lib/po-agent/escalate/forward";
import { getPoAgentConfig } from "@/lib/po-agent/config";
import { installMockFetch, TEST_CTX } from "@/tests/helpers/mock-fetch";
import type { InboundMessage } from "@/lib/po-agent/channel/types";
import type { PoSession, ValidationIssue } from "@/lib/po-agent/types";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function priceMismatch(stated: number, calculated: number, ref = "WIDGET-100"): ValidationIssue {
  return { kind: "price_mismatch", message: "differs", lineRef: ref, blocking: true, data: { stated, calculated } };
}

function makeSession(validation: ValidationIssue[]): PoSession {
  return {
    id: "google:t1",
    channel: "google",
    threadId: "t1",
    state: "escalated",
    clarificationRounds: 2,
    buyer: { email: "jane@acme.com", b2bUserId: 1, customerId: 42, companyId: 123, role: 1, companyName: "Acme" },
    validation,
    audit: [],
    messageIds: [],
    createdAt: "2026-07-23T12:00:00.000Z",
    updatedAt: "2026-07-23T12:00:00.000Z",
  };
}

const message: InboundMessage = {
  messageId: "m1",
  threadId: "t1",
  from: "jane@acme.com",
  subject: "PO 5567",
  bodyText: "Please ship at our usual price.",
  attachments: [],
};

function collector() {
  const sent: Array<{ to: string; subject: string; text: string }> = [];
  const sendEmail = async (to: string, subject: string, text: string) => {
    sent.push({ to, subject, text });
    return true;
  };
  return { sent, sendEmail };
}

const ON = getPoAgentConfig({ PO_AGENT_FORWARD_PRICE_MISMATCH: "true" });

describe("belowContractLines", () => {
  it("selects only stated-below-contract mismatches", () => {
    const s = makeSession([priceMismatch(8, 10, "A"), priceMismatch(12, 10, "B")]);
    const below = belowContractLines(s);
    expect(below.map((b) => b.ref)).toEqual(["A"]);
    expect(below[0]).toMatchObject({ stated: 8, calculated: 10, delta: 2 });
  });
});

describe("forwardBelowContractPo", () => {
  const reps = { url: "/companies/123/super-admins", body: { code: 200, data: [{ id: 1, firstName: "Sam", email: "sam@rep.com" }] } };
  const admins = { url: "/users?companyId=123&roles=0", body: { code: 200, data: [{ id: 9, firstName: "Ada", email: "ada@acme.com", role: "0" }] } };

  it("does nothing when the toggle is off", async () => {
    installMockFetch([reps, admins]);
    const { sent, sendEmail } = collector();
    const deps: ForwardDeps = { ctx: TEST_CTX, config: getPoAgentConfig({}), sendEmail };
    const out = await forwardBelowContractPo(deps, makeSession([priceMismatch(8, 10)]), message);
    expect(out).toEqual([]);
    expect(sent.length).toBe(0);
  });

  it("forwards to deduped sales rep + admin with validated numbers", async () => {
    installMockFetch([reps, admins]);
    const { sent, sendEmail } = collector();
    const out = await forwardBelowContractPo({ ctx: TEST_CTX, config: ON, sendEmail }, makeSession([priceMismatch(8, 10)]), message);
    expect(out.sort()).toEqual(["ada@acme.com", "sam@rep.com"]);
    expect(sent[0].subject).toContain("below-contract");
    expect(sent[0].text).toContain("$8.00");
    expect(sent[0].text).toContain("$10.00");
    expect(sent[0].text).toContain("Please ship at our usual price.");
  });

  it("skips when only above-contract mismatches exist", async () => {
    installMockFetch([reps, admins]);
    const { sendEmail } = collector();
    const out = await forwardBelowContractPo({ ctx: TEST_CTX, config: ON, sendEmail }, makeSession([priceMismatch(12, 10)]), message);
    expect(out).toEqual([]);
  });

  it("does not forward to the buyer's own address", async () => {
    installMockFetch([
      { url: "/companies/123/super-admins", body: { code: 200, data: [{ id: 1, email: "jane@acme.com" }] } },
      { url: "/users?companyId=123&roles=0", body: { code: 200, data: [{ id: 9, email: "ada@acme.com", role: "0" }] } },
    ]);
    const { sendEmail } = collector();
    const out = await forwardBelowContractPo({ ctx: TEST_CTX, config: ON, sendEmail }, makeSession([priceMismatch(8, 10)]), message);
    expect(out).toEqual(["ada@acme.com"]);
  });

  it("falls back to the company email when no reps/admins resolve", async () => {
    installMockFetch([
      { url: "/companies/123/super-admins", body: { code: 200, data: [] } },
      { url: "/users?companyId=123&roles=0", body: { code: 200, data: [] } },
      { url: "/companies/123", body: { code: 200, data: { companyId: 123, companyName: "Acme", companyEmail: "orders@acme.com", companyStatus: 1 } } },
    ]);
    const { sendEmail } = collector();
    const out = await forwardBelowContractPo({ ctx: TEST_CTX, config: ON, sendEmail }, makeSession([priceMismatch(8, 10)]), message);
    expect(out).toEqual(["orders@acme.com"]);
  });
});
