import { describe, it, expect, afterEach } from "vitest";
import { runSimulatedTurn, type ConversationDeps } from "@/lib/po-agent/rules/conversation";
import { approveHeldDraft } from "@/lib/po-agent/rules/drafts";
import { getRulesConfig } from "@/lib/po-agent/rules/config";
import { resolveClassifier } from "@/lib/po-agent/rules/classify";
import { SimulatorChannel } from "@/lib/po-agent/channel/simulator";
import { resolveExtractor } from "@/lib/po-agent/ai/extractor";
import { getPoAgentConfig } from "@/lib/po-agent/config";
import { createPoStore, type PoStore } from "@/lib/po-agent/store";
import { createMockRedis } from "@/tests/helpers/mock-redis";
import { installMockFetch, TEST_CTX } from "@/tests/helpers/mock-fetch";
import { termsReads, quoteWrites } from "@/tests/helpers/bc-fixtures";

// Simulated conversations end to end: the customer writes, the rules decide, the agent
// answers through the simulator channel (captured), and the customer can write again on
// the same thread. Store calls are mocked; Redis is in memory; the heuristic extractor and
// classifier keep it offline.

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const CHECKOUT = "https://store/checkout?q=9001";

function setup(opts: { reviewAll?: boolean; usersEmpty?: boolean; failQuote?: boolean } = {}) {
  const http = installMockFetch([
    ...(opts.failQuote ? [{ method: "POST", url: /\/rfq$/, status: 500, body: { code: 500, message: "boom" } }] : quoteWrites()),
    ...termsReads({ usersEmpty: opts.usersEmpty }),
  ]);
  const channel = new SimulatorChannel();
  const store = createPoStore(createMockRedis());
  let tick = 0;
  const deps: ConversationDeps = {
    ctx: TEST_CTX,
    config: getPoAgentConfig({}),
    rules: getRulesConfig({}, { reviewAll: opts.reviewAll ?? false }),
    store,
    channel,
    extract: resolveExtractor({}),
    classify: resolveClassifier({}),
    now: () => new Date(Date.UTC(2026, 9, 14, 12, 0, tick++)).toISOString(),
  };
  let n = 0;
  const send = (body: string, over: { threadId?: string; from?: string; mode?: "decide" | "reply"; subject?: string } = {}) => {
    const messageId = `sim-test-${++n}`;
    const msg = channel.inject({
      from: over.from ?? "buyer@acme.com",
      subject: over.subject ?? (over.threadId ? "Re: Quote request" : "Quote request"),
      bodyText: body,
      messageId,
      threadId: over.threadId ?? messageId,
    });
    return runSimulatedTurn(deps, msg, { mode: over.mode ?? "reply" });
  };
  return { http, channel, store: store as PoStore, deps, send };
}

const QUOTE = "Please quote:\nSKU: WIDGET-100 Qty: 10\nSKU: BOLT-250 Qty: 40";

describe("simulated conversation — reply mode", () => {
  it("quotes a known customer: real quote in the store, captured reply with the link and store prices", async () => {
    const { http, channel, store, send } = setup();
    const { session, record } = await send(QUOTE);

    expect(record.action).toBe("AUTO_RESPOND");
    expect(record.matched_scenarios).toEqual(expect.arrayContaining(["I1", "C1", "P1", "O2"]));
    expect(record.checkout_url).toBe(CHECKOUT);
    expect(session.simulated).toBe(true);
    expect(session.state).toBe("completed_quote");

    const created = http.calls.find((c) => c.method === "POST" && /\/rfq$/.test(c.url))!;
    expect((created.body as { companyId?: number }).companyId).toBe(123);
    expect((created.body as { quoteNotes?: string }).quoteNotes).toContain("[PO agent sandbox]");

    expect(channel.sent).toHaveLength(1);
    const text = channel.sent[0].reply.text;
    expect(text).toContain("WIDGET-100 — Widget — 10 × $9.84 = $98.40");
    expect(text).toContain("BOLT-250 — Bolt — 40 × $2.10 = $84.00");
    expect(text).toContain("Total: $182.40");
    expect(text).toContain(CHECKOUT);
    expect(text).toContain("Shipping and tax are calculated at checkout.");
    expect(session.messages?.map((m) => m.status)).toEqual(["received", "captured"]);

    // The trail shows the catalog search, the price lookup and the reply being written.
    const events = session.audit.map((a) => a.event);
    expect(events).toEqual(["received", "classified", "identified", "extracted", "resolved", "priced", "rules_decided", "submitted", "drafted", "outbound"]);
    const step = (e: string) => session.audit.find((a) => a.event === e)!;
    expect(step("resolved").summary).toMatch(/^Searched the catalog for 2 SKUs: WIDGET-100 and BOLT-250\. /);
    expect(step("priced").summary).toMatch(/^Looked up store prices for 2 lines at .+'s account pricing\. /);
    expect(step("priced").sources?.map((s) => s.value)).toEqual([9.84, 2.1]);
    expect(step("drafted").summary).toMatch(/^Wrote the quote reply: 2 lines at store prices, total \$182\.40, quote .+ and its checkout link\./);

    // Saved, and kept out of the dashboard counters.
    expect(await store.loadSession(session.id)).toMatchObject({ simulated: true, state: "completed_quote" });
    expect(await store.getCounters("202610")).toEqual({});
  });

  it("quotes a guest at list price with no company on the quote", async () => {
    const { http, channel, send } = setup({ usersEmpty: true });
    const { session, record } = await send(QUOTE, { from: "jane@newco.com" });

    expect(record.action).toBe("AUTO_RESPOND");
    expect(record.customer.guest).toBe(true);
    expect(record.matched_scenarios).toContain("C2");
    const created = http.calls.find((c) => c.method === "POST" && /\/rfq$/.test(c.url))!;
    expect(created.body).not.toHaveProperty("companyId");
    expect((created.body as { contactInfo: { email: string } }).contactInfo.email).toBe("jane@newco.com");
    expect(http.callsTo("/v3/pricing/products")[0].body).toMatchObject({ customer_group_id: 0 });
    expect(channel.sent[0].reply.text).toContain("guest checkout");
    expect(session.audit.find((a) => a.event === "priced")?.summary).toContain("at guest pricing.");
  });

  it("asks, then quotes when the customer answers on the same thread (Q8 → T2/T3)", async () => {
    const { channel, send } = setup();
    const first = await send("Please quote SKU: WIDGET-100");
    expect(first.record.action).toBe("CLARIFY");
    expect(first.session.state).toBe("clarifying");
    expect(channel.sent[0].reply.text).toContain("how many do you need? The price at quantity 1 is $9.84 each.");
    expect(channel.sent[0].reply.text).not.toContain("http");
    expect(first.session.audit.find((a) => a.event === "drafted")?.summary).toMatch(/^Wrote a clarifying reply with 1 question \(quantity on line 1\)\./);

    const second = await send("SKU: WIDGET-100 Qty: 25", { threadId: first.session.threadId });
    expect(second.session.id).toBe(first.session.id);
    expect(second.record.action).toBe("AUTO_RESPOND");
    expect(second.session.state).toBe("completed_quote");
    expect(channel.sent[1].reply.text).toContain("25 × $9.84 = $246.00");
    expect(second.session.messages?.filter((m) => m.direction === "in")).toHaveLength(2);
    expect(second.session.rules?.records.map((r) => r.action)).toEqual(["CLARIFY", "AUTO_RESPOND"]);
  });

  it("holds a draft when the answer still leaves it unclear (T5), and a person can approve it", async () => {
    const { channel, send } = setup();
    const first = await send("Please quote SKU: WIDGET-100");
    const second = await send("Not sure yet, let me check.", { threadId: first.session.threadId });

    expect(second.record.action).toBe("HOLD");
    expect(second.record.reason_codes).toEqual(["clarification_exhausted"]);
    expect(second.session.state).toBe("held");
    expect(channel.sent).toHaveLength(1); // the held draft wasn't sent
    const draft = second.session.messages!.at(-1)!;
    expect(draft.status).toBe("held");

    const r = await approveHeldDraft(second.session, draft.id, { actor: "Sales agent" });
    expect(r).toEqual({ ok: true });
    expect(draft.status).toBe("captured");
    expect(second.session.state).toBe("clarifying");
    expect(second.session.audit.at(-1)?.event).toBe("draft_approved");
    expect(second.session.rules?.records.at(-1)?.reply_status).toBe("sent");
  });

  it("escalates without replying, then stays quiet on the human-owned thread (T6)", async () => {
    const { channel, send } = setup();
    const first = await send(`Can you do better on price? We need a discount.\n${QUOTE}`);
    expect(first.record.action).toBe("ESCALATE");
    expect(first.record.reason_codes).toContain("discount_request");
    expect(first.session.state).toBe("escalated");
    expect(first.session.rules?.humanOwned).toBe(true);
    // No reply of any kind — sent or drafted. The handoff is for a sales agent.
    expect(channel.sent).toHaveLength(0);
    expect(first.session.messages?.map((m) => m.direction)).toEqual(["in"]);
    expect(first.record.reply).toBeNull();
    expect(first.record.reply_status).toBe("none");
    expect(first.session.audit.map((a) => a.event)).toContain("handoff");
    expect(first.session.audit.map((a) => a.event)).not.toContain("drafted");

    const second = await send("Hello? Any update?", { threadId: first.session.threadId });
    expect(second.record.action).toBe("NO_RESPONSE");
    expect(second.record.matched_scenarios).toEqual(["T6"]);
    expect(channel.sent).toHaveLength(0);
    expect(second.session.state).toBe("escalated");
  });

  it("review-all holds the quote draft with a real checkout link until approved", async () => {
    const { http, channel, send } = setup({ reviewAll: true });
    const { session, record } = await send(QUOTE);
    expect(record.action).toBe("HOLD");
    expect(record.reason_codes).toEqual(["review_all_mode"]);
    expect(http.callsTo("/rfq/9001/checkout")).toHaveLength(1);
    const draft = session.messages!.at(-1)!;
    expect(draft.status).toBe("held");
    expect(draft.text).toContain(CHECKOUT);
    expect(channel.sent).toHaveLength(0);

    await approveHeldDraft(session, draft.id, { actor: "Sales agent", text: `${draft.text}\n\nThanks, Mike` });
    expect(draft.status).toBe("captured");
    expect(draft.text).toContain("Thanks, Mike");
    expect(session.state).toBe("completed_quote");
  });

  it("resends the checkout link when the customer accepts (T1) without a second quote", async () => {
    const { http, channel, send } = setup();
    const first = await send(QUOTE);
    await send("Looks good, go ahead.", { threadId: first.session.threadId });
    expect(http.calls.filter((c) => c.method === "POST" && /\/rfq$/.test(c.url))).toHaveLength(1);
    expect(channel.sent[1].reply.text).toContain("Thanks for confirming.");
    expect(channel.sent[1].reply.text).toContain(CHECKOUT);
  });

  it("never stores or repeats card numbers (C8)", async () => {
    const { send } = setup();
    const { session, record } = await send(`${QUOTE}\nCharge card 4111 1111 1111 1111`);
    expect(record.action).toBe("ESCALATE");
    expect(record.reason_codes).toContain("payment_data");
    expect(JSON.stringify(session)).not.toContain("4111");
    expect(session.messages?.[0].text).toContain("[card number removed]");
  });

  it("escalates instead of quoting when the store can't create the quote (T14)", async () => {
    const { channel, send } = setup({ failQuote: true });
    const { session, record } = await send(QUOTE);
    expect(record.action).toBe("ESCALATE");
    expect(record.reason_codes).toEqual(["system_error"]);
    expect(channel.sent).toHaveLength(0);
    expect(session.audit.some((a) => a.event === "submitted" && a.outcome === "failed")).toBe(true);
  });

  it("escalates when the model is unavailable (T15)", async () => {
    const { deps, channel } = setup();
    deps.classify = async () => {
      throw new Error("model 529");
    };
    const msg = channel.inject({ from: "buyer@acme.com", subject: "Quote", bodyText: QUOTE, messageId: "sim-x", threadId: "sim-x" });
    const { record } = await runSimulatedTurn(deps, msg, { mode: "reply" });
    expect(record.action).toBe("ESCALATE");
    expect(record.matched_scenarios).toContain("T15");
  });
});

describe("simulated conversation — decide only", () => {
  it("decides and previews the reply without storing anything or creating a quote", async () => {
    const { http, channel, deps } = setup();
    const msg = channel.inject({ from: "buyer@acme.com", subject: "Quote request", bodyText: QUOTE, messageId: "sim-d", threadId: "sim-d" });
    const { session, record } = await runSimulatedTurn({ ...deps, store: undefined }, msg, { mode: "decide" });

    expect(record.action).toBe("AUTO_RESPOND");
    expect(record.reply_status).toBe("preview");
    expect(record.reply?.body).toContain("[the checkout link is created when this reply is sent]");
    expect(http.calls.filter((c) => c.method === "POST" && c.url.includes("/rfq"))).toHaveLength(0);
    expect(channel.sent).toHaveLength(0);
    expect(session.state).toBe("validating");
    const drafted = session.audit.find((a) => a.event === "drafted");
    expect(drafted?.summary).toContain("Decide only: this is a preview and nothing is sent.");
    expect(session.audit.map((a) => a.event)).not.toContain("outbound");
  });
});

describe("simulated conversation — token usage", () => {
  it("records model tokens for a decide-only run without saving the run", async () => {
    const { channel, deps, store } = setup();
    deps.classify = async (input) => ({
      classification: (await resolveClassifier({})(input)).classification,
      usage: { model: "anthropic:test-model", inputTokens: 1200, outputTokens: 350, totalTokens: 1550 },
    });
    const msg = channel.inject({ from: "buyer@acme.com", subject: "Quote request", bodyText: QUOTE, messageId: "sim-t", threadId: "sim-t" });
    const { session } = await runSimulatedTurn(deps, msg, { mode: "decide" });

    expect(Object.values(await store.getTokenUsage("202610")).some((v) => v > 0)).toBe(true);
    expect(await store.loadSession(session.id)).toBeNull();
  });
});
