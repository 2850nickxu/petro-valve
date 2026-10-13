import { describe, it, expect, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  VIEW_COOKIE,
  VIEW_HEADER,
  VIEW_HOME,
  canSeeAiModel,
  canSeeSettingGroup,
  canSeeUsage,
  parseView,
  viewForPath,
} from "@/lib/po-agent/admin-view";
import { SETTINGS_FIELDS, hiddenSettingKeys } from "@/lib/po-agent/settings-store";
import { middleware } from "@/middleware";

describe("admin views", () => {
  it("defaults to the Silk view, and only the two dashboards pick one", () => {
    expect(parseView(undefined)).toBe("silk");
    expect(parseView("nonsense")).toBe("silk");
    expect(parseView("customer")).toBe("customer");
    expect(VIEW_HOME).toEqual({ silk: "/staff/admin", customer: "/staff/customer" });
    expect(viewForPath("/staff/customer")).toBe("customer");
    expect(viewForPath("/staff/customer/")).toBe("customer");
    expect(viewForPath("/staff/admin")).toBe("silk");
    expect(viewForPath("/staff/sessions")).toBeUndefined();
    expect(viewForPath("/staff")).toBeUndefined();
  });

  it("keeps token usage and the AI model out of the customer view", () => {
    expect(canSeeUsage("silk")).toBe(true);
    expect(canSeeUsage("customer")).toBe(false);
    expect(canSeeAiModel("customer")).toBe(false);
    expect(canSeeSettingGroup("customer", "AI")).toBe(false);
    expect(canSeeSettingGroup("customer", "Workflow")).toBe(true);
    expect(canSeeSettingGroup("silk", "AI")).toBe(true);
  });

  it("hides exactly the AI settings from the customer, nothing from Silk", () => {
    const ai = SETTINGS_FIELDS.filter((f) => f.group === "AI").map((f) => f.key).sort();
    expect(ai).toEqual(["ANTHROPIC_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "OPENAI_API_KEY", "PO_AGENT_MODEL"]);
    expect([...hiddenSettingKeys("customer")].sort()).toEqual(ai);
    expect(hiddenSettingKeys("silk").size).toBe(0);
  });
});

describe("middleware picks the view on a dashboard visit", () => {
  afterEach(() => vi.unstubAllEnvs());

  // No staff secret outside production → the gate is open, so this exercises only the view.
  function run(path: string, headers: Record<string, string> = {}) {
    vi.stubEnv("PO_AGENT_STAFF_SECRET", "");
    return middleware(new NextRequest(`https://app.test${path}`, { headers }));
  }

  it("remembers the customer view and passes it to this render", async () => {
    const res = await run("/staff/customer");
    expect(res.cookies.get(VIEW_COOKIE)?.value).toBe("customer");
    expect(res.headers.get(`x-middleware-request-${VIEW_HEADER}`)).toBe("customer");
  });

  it("switches back to Silk from /staff/admin", async () => {
    const res = await run("/staff/admin", { cookie: `${VIEW_COOKIE}=customer` });
    expect(res.cookies.get(VIEW_COOKIE)?.value).toBe("silk");
    expect(res.headers.get(`x-middleware-request-${VIEW_HEADER}`)).toBe("silk");
  });

  it("leaves the view alone elsewhere, and drops a view header sent by the client", async () => {
    const res = await run("/staff/usage", { [VIEW_HEADER]: "silk" });
    expect(res.cookies.get(VIEW_COOKIE)).toBeUndefined();
    expect(res.headers.get(`x-middleware-request-${VIEW_HEADER}`)).toBeNull();
  });
});
