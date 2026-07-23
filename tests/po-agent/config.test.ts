import { describe, it, expect } from "vitest";
import { getPoAgentConfig, poAgentEnabled } from "@/lib/po-agent/config";

describe("getPoAgentConfig defaults (feature inert)", () => {
  it("is disabled and safe with an empty env", () => {
    const c = getPoAgentConfig({});
    expect(c.enabled).toBe(false);
    expect(c.mode).toBe("auto");
    expect(c.channel).toBe("google");
    expect(c.maxClarifications).toBe(2);
    expect(c.maxRepliesPerThread).toBe(6);
    expect(c.priceTolerancePct).toBe(1);
    expect(c.escalateValue).toBe(25000);
    expect(c.quoteEmail).toBe("own");
    expect(c.reminderDays).toBe(3);
    expect(c.sessionExpiryDays).toBe(10);
    expect(c.firstOrderConfirm).toBe(true);
    expect(c.simulatorSend).toBe(false);
    expect(c.channelMap).toEqual({});
    expect(c.poPaymentCodes).toEqual(["purchase_order", "cheque", "terms"]);
    expect(c.sessionTokenBudget).toBeUndefined();
    expect(c.dailySubmitCap).toBeUndefined();
  });

  it("poAgentEnabled mirrors the flag", () => {
    expect(poAgentEnabled({})).toBe(false);
    expect(poAgentEnabled({ PO_AGENT_ENABLED: "true" })).toBe(true);
    expect(poAgentEnabled({ PO_AGENT_ENABLED: "1" })).toBe(true);
    expect(poAgentEnabled({ PO_AGENT_ENABLED: "false" })).toBe(false);
  });
});

describe("getPoAgentConfig parsing", () => {
  it("parses booleans, numbers, csv and json", () => {
    const c = getPoAgentConfig({
      PO_AGENT_ENABLED: "true",
      PO_AGENT_MODE: "review",
      PO_AGENT_CHANNEL: "microsoft",
      PO_AGENT_MODEL: "anthropic:claude-sonnet-4-6",
      PO_AGENT_MAX_CLARIFICATIONS: "3",
      PO_AGENT_PRICE_TOLERANCE_PCT: "2.5",
      PO_AGENT_PO_PAYMENT_CODES: "terms, purchase_order ,net30",
      PO_AGENT_QUOTE_EMAIL: "native",
      PO_AGENT_FIRST_ORDER_CONFIRM: "false",
      PO_AGENT_SESSION_TOKEN_BUDGET: "50000",
      PO_AGENT_DAILY_SUBMIT_CAP: "100",
      PO_AGENT_CHANNEL_MAP: '{"poc@silkcommerce.com":1,"orders@brand-b.com":123456}',
      PO_AGENT_SIMULATOR_SEND: "true",
    });
    expect(c.enabled).toBe(true);
    expect(c.mode).toBe("review");
    expect(c.channel).toBe("microsoft");
    expect(c.model).toBe("anthropic:claude-sonnet-4-6");
    expect(c.maxClarifications).toBe(3);
    expect(c.priceTolerancePct).toBe(2.5);
    expect(c.poPaymentCodes).toEqual(["terms", "purchase_order", "net30"]);
    expect(c.quoteEmail).toBe("native");
    expect(c.firstOrderConfirm).toBe(false);
    expect(c.sessionTokenBudget).toBe(50000);
    expect(c.dailySubmitCap).toBe(100);
    expect(c.channelMap).toEqual({ "poc@silkcommerce.com": 1, "orders@brand-b.com": 123456 });
    expect(c.simulatorSend).toBe(true);
  });

  it("falls back gracefully on malformed json and bad numbers", () => {
    const c = getPoAgentConfig({
      PO_AGENT_CHANNEL_MAP: "{not valid json",
      PO_AGENT_MAX_CLARIFICATIONS: "abc",
    });
    expect(c.channelMap).toEqual({});
    expect(c.maxClarifications).toBe(2);
  });

  it("only accepts known enum values, else defaults", () => {
    const c = getPoAgentConfig({ PO_AGENT_MODE: "banana", PO_AGENT_CHANNEL: "carrier-pigeon" });
    expect(c.mode).toBe("auto");
    expect(c.channel).toBe("google");
  });
});
