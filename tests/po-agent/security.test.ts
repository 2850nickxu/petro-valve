import { describe, it, expect } from "vitest";
import { verifyInboundSecret, decodePubSubGmail } from "@/lib/po-agent/security";

function reqWith(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { headers });
}

describe("verifyInboundSecret", () => {
  it("accepts a matching ?token= or Bearer, rejects everything else", () => {
    expect(verifyInboundSecret(reqWith("https://x/api?token=s3cret"), "s3cret")).toBe(true);
    expect(verifyInboundSecret(reqWith("https://x/api", { authorization: "Bearer s3cret" }), "s3cret")).toBe(true);
    expect(verifyInboundSecret(reqWith("https://x/api?token=wrong"), "s3cret")).toBe(false);
    expect(verifyInboundSecret(reqWith("https://x/api"), "s3cret")).toBe(false);
    expect(verifyInboundSecret(reqWith("https://x/api?token=s3cret"), undefined)).toBe(false);
  });
});

describe("decodePubSubGmail", () => {
  it("decodes the base64 push envelope", () => {
    const payload = { emailAddress: "poc@silk.com", historyId: "12345" };
    const envelope = { message: { data: Buffer.from(JSON.stringify(payload)).toString("base64") } };
    expect(decodePubSubGmail(envelope)).toEqual(payload);
    expect(decodePubSubGmail({})).toBeNull();
    expect(decodePubSubGmail({ message: { data: "not-valid-json-base64" } })).toBeNull();
  });
});
