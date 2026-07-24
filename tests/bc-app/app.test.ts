import { describe, it, expect, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { verifySignedPayloadJwt } from "@/lib/bc-app/jwt";
import { signAppSession, verifyAppSession } from "@/lib/bc-app/session";
import { GET as authGET } from "@/app/api/bc-app/auth/route";
import { installMockFetch } from "@/tests/helpers/mock-fetch";

const CLIENT_ID = "app-client-id";
const SECRET = "app-client-secret";

function makeJwt(claims: object, secret: string): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const header = b64({ alg: "HS256", typ: "JWT" });
  const payload = b64(claims);
  const sig = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

const baseClaims = () => ({
  aud: CLIENT_ID,
  iss: "bc",
  iat: 1700000000,
  nbf: 1700000000,
  exp: Math.floor(Date.now() / 1000) + 3600,
  sub: "stores/ybhg7gjokp",
  user: { id: 1, email: "u@x.com" },
  owner: { id: 2, email: "owner@x.com" },
});

describe("verifySignedPayloadJwt", () => {
  it("accepts a valid token and extracts the store hash", () => {
    const p = verifySignedPayloadJwt(makeJwt(baseClaims(), SECRET), CLIENT_ID, SECRET);
    expect(p).toMatchObject({ storeHash: "ybhg7gjokp", owner: { email: "owner@x.com" } });
  });
  it("rejects a wrong signature, wrong audience, wrong issuer, and expiry", () => {
    expect(verifySignedPayloadJwt(makeJwt(baseClaims(), "nope"), CLIENT_ID, SECRET)).toBeNull();
    expect(verifySignedPayloadJwt(makeJwt({ ...baseClaims(), aud: "other" }, SECRET), CLIENT_ID, SECRET)).toBeNull();
    expect(verifySignedPayloadJwt(makeJwt({ ...baseClaims(), iss: "evil" }, SECRET), CLIENT_ID, SECRET)).toBeNull();
    expect(verifySignedPayloadJwt(makeJwt({ ...baseClaims(), exp: 1 }, SECRET), CLIENT_ID, SECRET)).toBeNull();
  });
});

describe("app session", () => {
  it("signs and verifies; rejects tampering", () => {
    const s = signAppSession("ybhg7gjokp", SECRET);
    expect(verifyAppSession(s, SECRET)).toBe("ybhg7gjokp");
    expect(verifyAppSession(s, "other")).toBeNull();
    expect(verifyAppSession("ybhg7gjokp.badsig", SECRET)).toBeNull();
  });
});

describe("auth callback (token exchange)", () => {
  const realFetch = globalThis.fetch;
  const prev = { id: process.env.BC_APP_CLIENT_ID, sec: process.env.BC_APP_CLIENT_SECRET };
  afterEach(() => {
    globalThis.fetch = realFetch;
    process.env.BC_APP_CLIENT_ID = prev.id;
    process.env.BC_APP_CLIENT_SECRET = prev.sec;
  });

  it("exchanges the code and reports the connected store", async () => {
    process.env.BC_APP_CLIENT_ID = CLIENT_ID;
    process.env.BC_APP_CLIENT_SECRET = SECRET;
    const mock = installMockFetch([
      { method: "POST", url: "login.bigcommerce.com/oauth2/token", body: { access_token: "at-xyz", scope: "store_v2_orders", context: "stores/ybhg7gjokp", owner: { email: "owner@x.com" } } },
    ]);
    const res = await authGET(new Request("https://app.example.com/api/bc-app/auth?code=abc&scope=store_v2_orders&context=stores/ybhg7gjokp"));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("installed");
    expect(html).toContain("ybhg7gjokp");
    // redirect_uri echoed the callback URL
    const body = mock.calls[0].body as { redirect_uri: string; grant_type: string };
    expect(body.redirect_uri).toBe("https://app.example.com/api/bc-app/auth");
    expect(body.grant_type).toBe("authorization_code");
  });
});
