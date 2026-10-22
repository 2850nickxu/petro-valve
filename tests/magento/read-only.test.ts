import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// The production Magento store is READ-ONLY for this app. This guard fails the build if
// anything in lib/magento gains a write: the only non-GET allowed is the admin-token login.

const DIR = path.resolve(__dirname, "../../lib/magento");
const sources = readdirSync(DIR)
  .filter((f) => f.endsWith(".ts"))
  .map((f) => ({ file: f, text: readFileSync(path.join(DIR, f), "utf8") }));

describe("lib/magento is read-only", () => {
  it("only client.ts calls fetch", () => {
    const callers = sources.filter((s) => /\bfetch\s*\(/.test(s.text)).map((s) => s.file);
    expect(callers).toEqual(["client.ts"]);
  });

  it("the only non-GET method is the admin-token POST", () => {
    const writes = sources.flatMap((s) =>
      [...s.text.matchAll(/method:\s*["'`](\w+)["'`]/g)].filter((m) => m[1] !== "GET").map((m) => `${s.file}:${m[1]}`),
    );
    expect(writes).toEqual(["client.ts:POST"]);
    const client = sources.find((s) => s.file === "client.ts")!.text;
    const post = client.indexOf('method: "POST"');
    expect(client.lastIndexOf("async function login(", post)).toBeGreaterThan(-1);
    expect(client.slice(client.lastIndexOf("async function login(", post), post)).toContain("/integration/admin/token");
  });

  it("exports no write helper", () => {
    const exported = sources.flatMap((s) => [...s.text.matchAll(/export (?:async )?function (\w+)/g)].map((m) => m[1]));
    expect(exported.filter((n) => /^magento(Post|Put|Delete|Fetch|Request)/i.test(n))).toEqual([]);
  });
});
