import { describe, it, expect } from "vitest";
import { badgeVariant } from "@/lib/ui/badge-variant";

describe("badgeVariant", () => {
  it("maps completed states to success", () => {
    expect(badgeVariant("completed_order")).toBe("success");
    expect(badgeVariant("completed_quote")).toBe("success");
  });
  it("maps failure states to danger", () => {
    expect(badgeVariant("escalated")).toBe("danger");
    expect(badgeVariant("rejected")).toBe("danger");
  });
  it("maps waiting states to warning", () => {
    expect(badgeVariant("clarifying")).toBe("warning");
    expect(badgeVariant("awaiting_confirmation")).toBe("warning");
  });
  it("maps in-flight states to info", () => {
    expect(badgeVariant("new")).toBe("info");
    expect(badgeVariant("identifying")).toBe("info");
    expect(badgeVariant("validating")).toBe("info");
    expect(badgeVariant("submitting")).toBe("info");
  });
  it("falls back to neutral for expired/unknown", () => {
    expect(badgeVariant("expired")).toBe("neutral");
    expect(badgeVariant("something-else")).toBe("neutral");
  });
});
