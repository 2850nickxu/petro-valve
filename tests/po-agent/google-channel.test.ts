import { describe, it, expect, afterEach } from "vitest";
import { GoogleChannel, parseGmailMessage } from "@/lib/po-agent/channel/google";
import { base64UrlEncode, base64UrlDecode, buildReplyRaw } from "@/lib/po-agent/channel/mime";
import { mintAccessToken } from "@/lib/po-agent/channel/google-auth";
import { installMockFetch, type MockRoute } from "@/tests/helpers/mock-fetch";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const CREDS = { clientId: "cid", clientSecret: "sec", refreshToken: "rt" };

function gmailMessage(id: string, from: string, text: string): unknown {
  return {
    id,
    threadId: `thr-${id}`,
    payload: {
      mimeType: "multipart/mixed",
      headers: [
        { name: "From", value: from },
        { name: "Subject", value: "New PO" },
        { name: "Message-ID", value: `<${id}@mail>` },
      ],
      parts: [
        { mimeType: "text/plain", body: { data: base64UrlEncode(text) } },
        { mimeType: "application/pdf", filename: "po.pdf", body: { attachmentId: `att-${id}` } },
      ],
    },
  };
}

describe("mime", () => {
  it("builds a threaded reply with In-Reply-To and References", () => {
    const raw = buildReplyRaw({ from: "poc@silk.com", to: "buyer@acme.com", subject: "Re: PO", text: "hi", inReplyTo: "<abc@mail>", references: "<r1@mail>" });
    const decoded = base64UrlDecode(raw).toString("utf8");
    expect(decoded).toContain("To: buyer@acme.com");
    expect(decoded).toContain("In-Reply-To: <abc@mail>");
    expect(decoded).toContain("References: <r1@mail> <abc@mail>");
    expect(decoded).toContain("\r\n\r\nhi");
  });
});

describe("mintAccessToken", () => {
  it("exchanges the refresh token", async () => {
    installMockFetch([{ method: "POST", url: "oauth2.googleapis.com/token", body: { access_token: "at-123" } }]);
    expect(await mintAccessToken(CREDS)).toBe("at-123");
  });
  it("returns null on failure", async () => {
    installMockFetch([{ method: "POST", url: "oauth2.googleapis.com/token", status: 400, body: {} }]);
    expect(await mintAccessToken(CREDS)).toBeNull();
  });
});

describe("parseGmailMessage", () => {
  it("extracts sender, subject, body text, attachments, headers", () => {
    const msg = parseGmailMessage(gmailMessage("m1", "Jane Buyer <buyer@acme.com>", "Please ship PO-1") as never);
    expect(msg.from).toBe("buyer@acme.com");
    expect(msg.subject).toBe("New PO");
    expect(msg.bodyText).toBe("Please ship PO-1");
    expect(msg.attachments[0]).toMatchObject({ filename: "po.pdf", mediaType: "application/pdf", attachmentId: "att-m1" });
    expect(msg.headers?.["message-id"]).toBe("<m1@mail>");
  });
});

describe("GoogleChannel", () => {
  const channel = new GoogleChannel({ mailbox: "poc@silk.com", creds: CREDS }, async () => "tok");

  it("syncs new messages from history, skipping its own sends", async () => {
    installMockFetch([
      { url: "/users/me/history?startHistoryId=100", body: { history: [{ messagesAdded: [{ message: { id: "m1" } }, { message: { id: "self" } }] }] } },
      { url: "/messages/m1?format=full", body: gmailMessage("m1", "buyer@acme.com", "PO body") },
      { url: "/messages/self?format=full", body: gmailMessage("self", "poc@silk.com", "our own reply") },
      { url: "/messages/m1/attachments/att-m1", body: { data: base64UrlEncode("PDFDATA") } },
    ]);
    const msgs = await channel.fetchNewMessages("100");
    expect(msgs).toHaveLength(1);
    expect(msgs[0].from).toBe("buyer@acme.com");
    expect(Buffer.from(msgs[0].attachments[0].data).toString("utf8")).toBe("PDFDATA");
  });

  it("full-resyncs when the watermark is too old (404)", async () => {
    installMockFetch([
      { url: "/users/me/history?startHistoryId=old", status: 404, body: {} },
      { url: "/messages?labelIds=INBOX", body: { messages: [{ id: "mr" }] } },
      { url: "/messages/mr?format=full", body: gmailMessage("mr", "buyer@acme.com", "resynced PO") },
      { url: "/messages/mr/attachments/att-mr", body: { data: base64UrlEncode("X") } },
    ]);
    const msgs = await channel.fetchNewMessages("old");
    expect(msgs.map((m) => m.messageId)).toEqual(["mr"]);
  });

  it("follows history pages", async () => {
    installMockFetch([
      { url: "/history?startHistoryId=200&historyTypes=messageAdded&pageToken=p2", body: { history: [{ messagesAdded: [{ message: { id: "m2" } }] }] } },
      { url: "/history?startHistoryId=200", body: { history: [{ messagesAdded: [{ message: { id: "m1" } }] }], nextPageToken: "p2" } },
      { url: "/messages/m1?format=full", body: gmailMessage("m1", "buyer@acme.com", "first") },
      { url: "/messages/m2?format=full", body: gmailMessage("m2", "buyer@acme.com", "second") },
      { url: "/attachments/", body: { data: base64UrlEncode("X") } },
    ]);
    const msgs = await channel.fetchNewMessages("200");
    expect(msgs.map((m) => m.messageId)).toEqual(["m1", "m2"]);
  });

  it("throws on a failed history or message read rather than reporting no mail", async () => {
    // Callers advance the watermark after a sync; an empty result here would skip mail.
    installMockFetch([{ url: "/users/me/history?startHistoryId=300", status: 500, body: {} }]);
    await expect(channel.fetchNewMessages("300")).rejects.toThrow(/history read failed \(500\)/);

    installMockFetch([
      { url: "/users/me/history?startHistoryId=301", body: { history: [{ messagesAdded: [{ message: { id: "gone" } }] }] } },
      { url: "/messages/gone?format=full", status: 503, body: {} },
    ]);
    await expect(channel.fetchNewMessages("301")).rejects.toThrow(/message gone read failed \(503\)/);
  });

  it("reports the mailbox's current history id as the next watermark", async () => {
    installMockFetch([{ url: "/users/me/profile", body: { emailAddress: "poc@silk.com", historyId: "4242" } }]);
    expect(await channel.currentWatermark()).toBe("4242");
  });

  it("sends a threaded reply", async () => {
    const mock = installMockFetch([{ method: "POST", url: "/messages/send", body: { id: "sent-1", threadId: "thr-m1" } }]);
    const out = await channel.sendReply(
      { threadId: "thr-m1", to: "buyer@acme.com", rfcMessageId: "<m1@mail>", references: "<r0@mail>", subject: "Re: New PO" },
      { subject: "Re: New PO", text: "Your order is placed." },
    );
    expect(out).toEqual({ messageId: "sent-1", threadId: "thr-m1" });
    const body = mock.calls.find((c) => c.url.includes("/messages/send"))!.body as { raw: string; threadId: string };
    expect(body.threadId).toBe("thr-m1");
    const decoded = base64UrlDecode(body.raw).toString("utf8");
    expect(decoded).toContain("In-Reply-To: <m1@mail>");
    expect(decoded).toContain("To: buyer@acme.com");
  });

  it("throws when Gmail rejects the send", async () => {
    installMockFetch([{ method: "POST", url: "/messages/send", status: 400, body: { error: { message: "Invalid To header" } } }]);
    await expect(
      channel.sendReply({ threadId: "thr-m1", to: "buyer@acme.com", subject: "Re: New PO" }, { subject: "Re: New PO", text: "hi" }),
    ).rejects.toThrow("Gmail send failed (400): Invalid To header");
  });

  it("loop-guards its own address and auto-replies", () => {
    expect(channel.isLoopMessage({ messageId: "1", threadId: "t", from: "poc@silk.com", subject: "", bodyText: "", attachments: [] })).toBe(true);
    expect(channel.isLoopMessage({ messageId: "1", threadId: "t", from: "b@x.com", subject: "", bodyText: "", attachments: [], headers: { "auto-submitted": "auto-replied" } })).toBe(true);
    expect(channel.isLoopMessage({ messageId: "1", threadId: "t", from: "b@x.com", subject: "", bodyText: "", attachments: [] })).toBe(false);
  });
});
