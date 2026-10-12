import { describe, it, expect } from "vitest";
import {
  createPreviewCode,
  endPreviewSession,
  isPreviewDeployment,
  loadPreviewSession,
  normalizeCode,
  redeemPreviewCode,
} from "@/lib/po-agent/preview-access";
import { createMockRedis } from "@/tests/helpers/mock-redis";

describe("preview access", () => {
  it("only previews accept codes", () => {
    expect(isPreviewDeployment({ VERCEL_ENV: "preview" })).toBe(true);
    expect(isPreviewDeployment({ VERCEL_ENV: "production" })).toBe(false);
    expect(isPreviewDeployment({})).toBe(false);
  });

  it("mints a grouped, unambiguous 16-char code with a 10-minute expiry", async () => {
    const now = new Date("2026-10-12T12:00:00.000Z");
    const { code, expiresAt } = await createPreviewCode(createMockRedis(), "abc123", now);
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$/);
    expect(expiresAt).toBe("2026-10-12T12:10:00.000Z");
  });

  it("normalises case, spaces and dashes; rejects bad input", () => {
    expect(normalizeCode("abcd efgh-jkmn pqrs")).toBe("ABCD-EFGH-JKMN-PQRS");
    expect(normalizeCode("ABCD-EFGH-JKMN")).toBeNull(); // too short
    expect(normalizeCode("ABCD-EFGH-JKMN-PQR0")).toBeNull(); // 0 isn't in the alphabet
  });

  it("redeems once into a session bound to the minting store", async () => {
    const redis = createMockRedis();
    const { code } = await createPreviewCode(redis, "abc123");

    const first = await redeemPreviewCode(redis, code.toLowerCase());
    expect(first?.grant.storeHash).toBe("abc123");
    expect(first?.sessionId).toMatch(/^[0-9a-f]{64}$/);
    expect(await loadPreviewSession(redis, first!.sessionId)).toMatchObject({ storeHash: "abc123" });

    // Single use.
    expect(await redeemPreviewCode(redis, code)).toBeNull();
  });

  it("carries a global (no-store) grant through", async () => {
    const redis = createMockRedis();
    const { code } = await createPreviewCode(redis, null);
    const r = await redeemPreviewCode(redis, code);
    expect(r?.grant.storeHash).toBeNull();
    expect(await loadPreviewSession(redis, r!.sessionId)).not.toBeNull();
  });

  it("rejects unknown codes and malformed session ids", async () => {
    const redis = createMockRedis();
    expect(await redeemPreviewCode(redis, "ABCD-EFGH-JKMN-PQRS")).toBeNull();
    expect(await loadPreviewSession(redis, undefined)).toBeNull();
    expect(await loadPreviewSession(redis, "poa:app:store:abc123")).toBeNull();
  });

  it("ends a session", async () => {
    const redis = createMockRedis();
    const { code } = await createPreviewCode(redis, "abc123");
    const r = await redeemPreviewCode(redis, code);
    await endPreviewSession(redis, r!.sessionId);
    expect(await loadPreviewSession(redis, r!.sessionId)).toBeNull();
  });
});
