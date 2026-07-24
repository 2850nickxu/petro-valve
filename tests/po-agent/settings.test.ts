import { describe, it, expect } from "vitest";
import { encryptValue, decryptValue, SECRET_KEYS, EDITABLE_KEYS } from "@/lib/po-agent/settings-store";
import { effectiveEnv } from "@/lib/po-agent/effective-env";

describe("settings encryption", () => {
  it("round-trips a secret (AES-GCM)", () => {
    const secret = "sk-ant-super-secret-value";
    const enc = encryptValue(secret);
    expect(enc.startsWith("v1:")).toBe(true);
    expect(enc).not.toContain(secret);
    expect(decryptValue(enc)).toBe(secret);
  });
  it("classifies secret vs non-secret fields", () => {
    expect(SECRET_KEYS.has("ANTHROPIC_API_KEY")).toBe(true);
    expect(SECRET_KEYS.has("PO_AGENT_MODEL")).toBe(false);
    expect(EDITABLE_KEYS).toContain("PO_AGENT_MODE");
  });
});

describe("effectiveEnv", () => {
  it("passes base env through when no store settings are configured", async () => {
    const env = await effectiveEnv(undefined, { FOO: "bar", PO_AGENT_MODEL: "anthropic:x" });
    expect(env.FOO).toBe("bar");
    expect(env.PO_AGENT_MODEL).toBe("anthropic:x");
  });
});
