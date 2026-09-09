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
  it("maps in-flight states to primary", () => {
    expect(badgeVariant("new")).toBe("primary");
    expect(badgeVariant("identifying")).toBe("primary");
    expect(badgeVariant("validating")).toBe("primary");
    expect(badgeVariant("submitting")).toBe("primary");
  });
  it("falls back to secondary for expired/unknown", () => {
    expect(badgeVariant("expired")).toBe("secondary");
    expect(badgeVariant("something-else")).toBe("secondary");
  });
});
