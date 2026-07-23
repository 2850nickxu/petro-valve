import { describe, it, expect, afterEach } from "vitest";
import { MicrosoftChannel, parseGraphMessage, mintGraphToken } from "@/lib/po-agent/channel/microsoft";
import { POST as microsoftWebhook } from "@/app/api/po-agent/inbound/microsoft/route";
import { installMockFetch } from "@/tests/helpers/mock-fetch";
import type { EmailChannel } from "@/lib/po-agent/channel/types";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const CFG = { tenantId: "t", clientId: "c", clientSecret: "s", mailbox: "poc@silk.com" };

function graphMsg(id: string, from: string, hasAttachments = false): unknown {
  return {
    id,
    conversationId: `conv-${id}`,
    subject: "New PO",
    from: { emailAddress: { address: from } },
    body: { contentType: "html", content: "<p>Please ship <b>PO-1</b></p>" },
    internetMessageId: `<${id}@mail>`,
    hasAttachments,
  };
}

describe("parseGraphMessage", () => {
  it("strips HTML, lowercases sender, keeps message-id", () => {
    const msg = parseGraphMessage(graphMsg("gm1", "Buyer@Acme.com") as never);
    expect(msg.from).toBe("buyer@acme.com");
    expect(msg.bodyText).toBe("Please ship PO-1");
    expect(msg.threadId).toBe("conv-gm1");
    expect(msg.headers?.["message-id"]).toBe("<gm1@mail>");
  });
});

describe("mintGraphToken", () => {
  it("uses the client-credentials flow", async () => {
    installMockFetch([{ method: "POST", url: "login.microsoftonline.com", body: { access_token: "gtok" } }]);
    expect(await mintGraphToken(CFG)).toBe("gtok");
  });
});

describe("MicrosoftChannel", () => {
  const channel = new MicrosoftChannel(CFG, async () => "tok");

  it("conforms to EmailChannel", () => {
    const asChannel: EmailChannel = channel;
    expect(asChannel.id).toBe("microsoft");
    expect(typeof asChannel.fetchNewMessages).toBe("function");
    expect(typeof asChannel.sendReply).toBe("function");
    expect(typeof asChannel.isLoopMessage).toBe("function");
  });

  it("lists inbox messages, skips its own, hydrates attachments", async () => {
    installMockFetch([
      { url: "mailFolders('inbox')/messages", body: { value: [graphMsg("gm1", "buyer@acme.com", true), graphMsg("self", "poc@silk.com")] } },
      { url: "/messages/gm1/attachments", body: { value: [{ id: "a1", name: "po.pdf", contentType: "application/pdf", contentBytes: Buffer.from("PDF").toString("base64") }] } },
    ]);
    const msgs = await channel.fetchNewMessages(null);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].from).toBe("buyer@acme.com");
    expect(Buffer.from(msgs[0].attachments[0].data).toString("utf8")).toBe("PDF");
  });

  it("replies via Graph /reply with a comment", async () => {
    const mock = installMockFetch([{ method: "POST", url: "/messages/gm1/reply", body: {} }]);
    const out = await channel.sendReply({ threadId: "conv-gm1", inReplyToMessageId: "gm1", to: "buyer@acme.com", subject: "Re: New PO" }, { subject: "Re: New PO", text: "Your order is placed." });
    expect(out.messageId).toBe("graph-reply-gm1");
    expect((mock.calls[0].body as { comment: string }).comment).toBe("Your order is placed.");
  });

  it("loop-guards its own mailbox", () => {
    expect(channel.isLoopMessage({ messageId: "1", threadId: "t", from: "poc@silk.com", subject: "", bodyText: "", attachments: [] })).toBe(true);
    expect(channel.isLoopMessage({ messageId: "1", threadId: "t", from: "b@x.com", subject: "", bodyText: "", attachments: [] })).toBe(false);
  });
});

describe("Graph webhook validation handshake", () => {
  it("echoes the validationToken", async () => {
    const res = await microsoftWebhook(new Request("https://x/api/po-agent/inbound/microsoft?validationToken=abc123", { method: "POST" }));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("abc123");
  });
});
