import type { EmailChannel, InboundMessage, OutboundReply, ThreadRef, Attachment } from "./types";

// Microsoft Graph EmailChannel adapter (client-credentials flow, mailbox-scoped by an
// Exchange application access policy). Conforms to the same EmailChannel interface as
// Gmail. Ships tested-but-unwired — live verification ([L9]) needs an M365 tenant.

const GRAPH = "https://graph.microsoft.com/v1.0";

export interface MsGraphConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  mailbox: string; // UPN of the monitored mailbox
}

export function msCredsFromEnv(env: Record<string, string | undefined> = process.env): MsGraphConfig | null {
  const tenantId = env.MS_PO_TENANT_ID;
  const clientId = env.MS_PO_CLIENT_ID;
  const clientSecret = env.MS_PO_CLIENT_SECRET;
  const mailbox = env.MS_PO_MAILBOX;
  if (!tenantId || !clientId || !clientSecret || !mailbox) return null;
  return { tenantId, clientId, clientSecret, mailbox };
}

export async function mintGraphToken(cfg: MsGraphConfig): Promise<string | null> {
  try {
    const res = await fetch(`https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }).toString(),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { access_token?: string };
    return json.access_token ?? null;
  } catch {
    return null;
  }
}

interface GraphMessage {
  id: string;
  conversationId?: string;
  subject?: string;
  from?: { emailAddress?: { address?: string } };
  body?: { contentType?: string; content?: string };
  internetMessageId?: string;
  internetMessageHeaders?: Array<{ name: string; value: string }>;
  hasAttachments?: boolean;
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Pure: Graph message resource → InboundMessage (attachment data left empty). */
export function parseGraphMessage(m: GraphMessage): InboundMessage {
  const headers: Record<string, string> = {};
  for (const h of m.internetMessageHeaders ?? []) headers[h.name.toLowerCase()] = h.value;
  if (m.internetMessageId) headers["message-id"] = m.internetMessageId;
  const raw = m.body?.content ?? "";
  const bodyText = (m.body?.contentType ?? "").toLowerCase() === "html" ? htmlToText(raw) : raw.trim();
  return {
    messageId: m.id,
    threadId: m.conversationId ?? m.id,
    from: (m.from?.emailAddress?.address ?? "").toLowerCase(),
    subject: m.subject ?? "",
    bodyText,
    attachments: [],
    headers,
  };
}

export class MicrosoftChannel implements EmailChannel {
  readonly id = "microsoft" as const;

  constructor(
    private readonly cfg: MsGraphConfig,
    private readonly tokenProvider: () => Promise<string | null> = () => mintGraphToken(cfg),
  ) {}

  private async token(): Promise<string> {
    const t = await this.tokenProvider();
    if (!t) throw new Error("MicrosoftChannel: could not mint a Graph token");
    return t;
  }

  private base(): string {
    return `${GRAPH}/users/${encodeURIComponent(this.cfg.mailbox)}`;
  }

  private async graph<T>(token: string, path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; json: T }> {
    const res = await fetch(`${this.base()}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init?.headers },
      cache: "no-store",
    });
    const json = (await res.json().catch(() => ({}))) as T;
    return { ok: res.ok, status: res.status, json };
  }

  isLoopMessage(msg: InboundMessage): boolean {
    if (msg.from === this.cfg.mailbox.toLowerCase()) return true;
    const auto = msg.headers?.["auto-submitted"];
    if (auto && auto.toLowerCase() !== "no") return true;
    if (msg.headers?.["x-autoreply"]) return true;
    return false;
  }

  private async hydrate(token: string, msg: InboundMessage, hasAttachments: boolean): Promise<InboundMessage> {
    if (!hasAttachments) return msg;
    const { json } = await this.graph<{ value?: Array<{ id: string; name?: string; contentType?: string; contentBytes?: string }> }>(
      token,
      `/messages/${msg.messageId}/attachments`,
    );
    msg.attachments = (json.value ?? [])
      .filter((a) => a.contentBytes)
      .map(
        (a): Attachment => ({
          attachmentId: a.id,
          filename: a.name ?? "attachment",
          mediaType: a.contentType ?? "application/octet-stream",
          data: Buffer.from(a.contentBytes!, "base64"),
        }),
      );
    return msg;
  }

  async fetchNewMessages(_sinceWatermark: string | null = null): Promise<InboundMessage[]> {
    void _sinceWatermark; // Graph uses subscriptions/delta; POC lists recent inbox.
    const token = await this.token();
    const { json } = await this.graph<{ value?: GraphMessage[] }>(
      token,
      `/mailFolders('inbox')/messages?$top=25&$orderby=receivedDateTime desc`,
    );
    const out: InboundMessage[] = [];
    for (const gm of json.value ?? []) {
      const parsed = parseGraphMessage(gm);
      if (this.isLoopMessage(parsed)) continue;
      out.push(await this.hydrate(token, parsed, Boolean(gm.hasAttachments)));
    }
    return out;
  }

  async getMessage(messageId: string): Promise<InboundMessage> {
    const token = await this.token();
    const { json } = await this.graph<GraphMessage>(token, `/messages/${messageId}`);
    return this.hydrate(token, parseGraphMessage(json), Boolean(json.hasAttachments));
  }

  async getAttachment(messageId: string, attachmentId: string): Promise<Buffer> {
    const token = await this.token();
    const { json } = await this.graph<{ contentBytes?: string }>(token, `/messages/${messageId}/attachments/${attachmentId}`);
    return json.contentBytes ? Buffer.from(json.contentBytes, "base64") : Buffer.alloc(0);
  }

  async sendReply(thread: ThreadRef, reply: OutboundReply): Promise<{ messageId: string }> {
    if (!thread.inReplyToMessageId) throw new Error("MicrosoftChannel.sendReply: no message to reply to (thread.inReplyToMessageId)");
    const token = await this.token();
    // Graph /reply threads automatically; the comment becomes the reply body. It returns
    // 202 with no body, so there is no id for the sent message.
    const { ok, status } = await this.graph(token, `/messages/${thread.inReplyToMessageId}/reply`, {
      method: "POST",
      body: JSON.stringify({ comment: reply.text }),
    });
    if (!ok) throw new Error(`Graph reply failed (${status})`);
    return { messageId: `graph-reply-${thread.inReplyToMessageId}` };
  }

  async sendEmail(to: string, subject: string, text: string): Promise<boolean> {
    const token = await this.token();
    const { ok } = await this.graph(token, `/sendMail`, {
      method: "POST",
      body: JSON.stringify({
        message: { subject, body: { contentType: "Text", content: text }, toRecipients: [{ emailAddress: { address: to } }] },
        saveToSentItems: true,
      }),
    });
    return ok;
  }

  async markProcessed(messageId: string): Promise<void> {
    const token = await this.token();
    await this.graph(token, `/messages/${messageId}`, { method: "PATCH", body: JSON.stringify({ isRead: true }) });
  }

  async renewSubscription(): Promise<{ expiresAt: string }> {
    const token = await this.token();
    const expirationDateTime = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString();
    const res = await fetch(`${GRAPH}/subscriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        changeType: "created",
        notificationUrl: process.env.MS_PO_NOTIFICATION_URL ?? "",
        resource: `/users/${this.cfg.mailbox}/mailFolders('inbox')/messages`,
        expirationDateTime,
        clientState: process.env.PO_AGENT_INBOUND_SECRET ?? "",
      }),
      cache: "no-store",
    });
    return { expiresAt: res.ok ? expirationDateTime : "" };
  }
}
