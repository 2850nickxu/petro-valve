import { describe, it, expect } from "vitest";
import { verifiedStoreHash, resolveStoreContextForHash } from "@/lib/bc-app/resolve-context";
import { signAppSession } from "@/lib/bc-app/session";

const ENV = { BC_APP_CLIENT_ID: "cid", BC_APP_CLIENT_SECRET: "sec" };

describe("verifiedStoreHash", () => {
  it("returns the store hash for a valid signed cookie", () => {
    const cookie = signAppSession("ybhg7gjokp", "sec");
    expect(verifiedStoreHash(cookie, ENV)).toBe("ybhg7gjokp");
  });
  it("rejects tampering / missing creds", () => {
    const cookie = signAppSession("ybhg7gjokp", "sec");
    expect(verifiedStoreHash(cookie, { ...ENV, BC_APP_CLIENT_SECRET: "other" })).toBeNull();
    expect(verifiedStoreHash("ybhg7gjokp.bad", ENV)).toBeNull();
    expect(verifiedStoreHash(cookie, {})).toBeNull();
    expect(verifiedStoreHash(undefined, ENV)).toBeNull();
  });
});

describe("resolveStoreContextForHash", () => {
  it("falls back to the env store when no install hash", async () => {
    const ctx = await resolveStoreContextForHash(null, {
      BIGCOMMERCE_STORE_HASH: "envstore",
      BIGCOMMERCE_ACCESS_TOKEN: "envtoken",
      BIGCOMMERCE_CHANNEL_ID: "1",
    });
    expect(ctx).toMatchObject({ storeHash: "envstore", accessToken: "envtoken", channelId: 1 });
  });

  it("returns null when neither install nor env is available", async () => {
    // No Redis configured ⇒ storeContextForInstall is null; no env ⇒ null.
    expect(await resolveStoreContextForHash(null, {})).toBeNull();
  });
});
