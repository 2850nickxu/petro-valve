import { describe, it, expect } from "vitest";
import { SALES_AGENT, actorLabel, customerEmail, isDefaultActor } from "@/lib/po-agent/people";
import { lineSeverity } from "@/lib/ui/line-severity";

describe("actorLabel", () => {
  it("calls anyone acting in the app the Sales agent, including legacy 'staff' records", () => {
    for (const a of [undefined, null, "", "  ", "staff", "Staff", "Sales agent", "sales agent"]) {
      expect(actorLabel(a)).toBe(SALES_AGENT);
      expect(isDefaultActor(a)).toBe(true);
    }
  });

  it("keeps a named identity if one was ever recorded", () => {
    expect(actorLabel("Grant")).toBe("Grant");
    expect(isDefaultActor("Grant")).toBe(false);
  });
});

describe("customerEmail", () => {
  it("identifies the customer by the matched buyer's email, else the sender", () => {
    expect(customerEmail({ buyer: { email: "ada@acme.com" }, inbound: { from: "other@acme.com" } })).toBe("ada@acme.com");
    expect(customerEmail({ buyer: null, inbound: { from: "who@nowhere.com" } })).toBe("who@nowhere.com");
    expect(customerEmail({})).toBe("Unknown sender");
  });
});

describe("lineSeverity", () => {
  it("treats a SKU/description conflict as serious, like an unmatched line", () => {
    expect(lineSeverity(["line_sku_description_conflict"])).toBe("bad");
    expect(lineSeverity(["price_mismatch", "line_inventory_short"])).toBe("bad");
    expect(lineSeverity(["line_inventory_short"])).toBe("warn");
    expect(lineSeverity([])).toBe("ok");
  });
});
