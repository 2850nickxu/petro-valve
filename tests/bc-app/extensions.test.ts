import { describe, it, expect, afterEach } from "vitest";
import { registerAppExtensions, DESIRED_EXTENSIONS } from "@/lib/bc-app/extensions";
import { handleExtension } from "@/lib/bc-app/ext-response";
import { createHmac } from "node:crypto";
import { installMockFetch, TEST_CTX, type MockRequest } from "@/tests/helpers/mock-fetch";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  process.env.BC_APP_CLIENT_ID = undefined;
  process.env.BC_APP_CLIENT_SECRET = undefined;
});

describe("registerAppExtensions", () => {
  it("creates the missing panels and keeps existing ones (idempotent)", async () => {
    const mock = installMockFetch([
      // list query: ORDERS panel already exists, CUSTOMERS does not
      {
        method: "POST",
        url: "/graphql",
        body: (req: MockRequest) => {
          const q = (req.body as { query: string }).query;
          if (q.includes("appExtensions {")) {
            return { data: { store: { appExtensions: { edges: [{ node: { id: "bc/store/appExtension/1", url: "/api/bc-app/ext/orders/${id}", model: "ORDERS", context: "PANEL" } }] } } } };
          }
          return { data: { appExtension: { createAppExtension: { appExtension: { id: "bc/store/appExtension/2" } } } } };
        },
      },
    ]);
    const result = await registerAppExtensions(TEST_CTX);
    expect(result.error).toBeUndefined();
    expect(result.existing).toContain("bc/store/appExtension/1"); // ORDERS kept
    expect(result.created).toContain("bc/store/appExtension/2"); // CUSTOMERS created
    // one list + one create call
    expect(mock.callsTo("/graphql").length).toBe(2);
    expect(DESIRED_EXTENSIONS.map((e) => e.model)).toEqual(["ORDERS", "CUSTOMERS"]);
  });

  it("surfaces a GraphQL error (e.g. missing scope) without throwing", async () => {
    installMockFetch([{ method: "POST", url: "/graphql", body: { errors: [{ message: "missing scope" }] } }]);
    const result = await registerAppExtensions(TEST_CTX);
    expect(result.error).toMatch(/missing scope/);
  });
});

function makeJwt(claims: object, secret: string): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const header = b64({ alg: "HS256", typ: "JWT" });
  const payload = b64(claims);
  const sig = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

describe("extension load handler", () => {
  it("verifies the JWT and redirects to the panel with an app-session cookie", () => {
    process.env.BC_APP_CLIENT_ID = "cid";
    process.env.BC_APP_CLIENT_SECRET = "sec";
    const jwt = makeJwt(
      { aud: "cid", iss: "bc", exp: Math.floor(Date.now() / 1000) + 3600, sub: "stores/ybhg7gjokp", user: { id: 1, email: "u@x.com" }, owner: { id: 2, email: "o@x.com" }, url: "/api/bc-app/ext/orders/106" },
      "sec",
    );
    const res = handleExtension(new Request(`https://app.example.com/api/bc-app/ext/orders/106?signed_payload_jwt=${jwt}`), "/app-panel/orders/106");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/app-panel/orders/106");
    expect(res.headers.get("set-cookie")).toContain("poa_app=");
  });

  it("rejects an unsigned request", () => {
    process.env.BC_APP_CLIENT_ID = "cid";
    process.env.BC_APP_CLIENT_SECRET = "sec";
    const res = handleExtension(new Request("https://app.example.com/api/bc-app/ext/orders/106"), "/app-panel/orders/106");
    expect(res.status).toBe(401);
  });
});
