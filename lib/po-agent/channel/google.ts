import type { EmailChannel, InboundMessage, OutboundReply, ThreadRef, Attachment } from "./types";
import { mintAccessToken, type GoogleOAuthCreds } from "./google-auth";
import { base64UrlDecode, buildReplyRaw } from "./mime";

// Gmail EmailChannel adapter. Reads via history sync (watermarked), sends threaded
// replies, and renews the users.watch subscription. Loop-guards skip its own sends and
// auto-replies. Live verification is the [L7] step; the parsing/watermark/threading logic
// here is unit-tested offline.

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users";

interface GmailHeader {
  name: string;
  value: string;
}
interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: GmailPart[];
}
interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  payload?: GmailPart;
}

function parseAddress(raw: string): string {
  const m = raw.match(/<([^>]+)>/);
  return (m ? m[1] : raw).trim().toLowerCase();
}

function walk(part: GmailPart, text: string[], attachments: Attachment[]): void {
  if (part.mimeType === "text/plain" && part.body?.data) {
    text.push(base64UrlDecode(part.body.data).toString("utf8"));
  }
  if (part.filename && part.body?.attachmentId) {
    attachments.push({
      attachmentId: part.body.attachmentId,
      filename: part.filename,
      mediaType: part.mimeType ?? "application/octet-stream",
      data: Buffer.alloc(0),
    });
  }
  for (const sub of part.parts ?? []) walk(sub, text, attachments);
}

/** Pure: Gmail message resource → InboundMessage (attachment data left empty). */
export function parseGmailMessage(msg: GmailMessage): InboundMessage {
  const headers: Record<string, string> = {};
  for (const h of msg.payload?.headers ?? []) headers[h.name.toLowerCase()] = h.value;

  const text: string[] = [];
  const attachments: Attachment[] = [];
  if (msg.payload) walk(msg.payload, text, attachments);

  return {
    messageId: msg.id,
    threadId: msg.threadId,
    from: parseAddress(headers["from"] ?? ""),
    subject: headers["subject"] ?? "",
    bodyText: text.join("\n").trim(),
    attachments,
    headers,
  };
}

export interface GoogleChannelConfig {
  /** Monitored mailbox address (used as From and for the self-send loop guard). */
  mailbox: string;
  userId?: string; // Gmail userId, default "me"
  creds: GoogleOAuthCreds;
  pubsubTopic?: string;
}

export class GoogleChannel implements EmailChannel {
  readonly id = "google" as const;
  private readonly userId: string;

  constructor(
    private readonly cfg: GoogleChannelConfig,
    private readonly tokenProvider: () => Promise<string | null> = () => mintAccessToken(cfg.creds),
  ) {
    this.userId = cfg.userId ?? "me";
  }

  private async token(): Promise<string> {
    const t = await this.tokenProvider();
    if (!t) throw new Error("GoogleChannel: could not mint an access token");
    return t;
  }

  private async gmail<T>(token: string, path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; json: T }> {
    const res = await fetch(`${GMAIL_BASE}/${this.userId}${path}`, {
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
    const prec = (msg.headers?.["precedence"] ?? "").toLowerCase();
    if (["bulk", "auto_reply", "list"].includes(prec)) return true;
    return false;
  }

  private async messageIdsFromHistory(token: string, startHistoryId: string): Promise<string[] | null> {
    const { ok, status, json } = await this.gmail<{ history?: Array<{ messagesAdded?: Array<{ message: { id: string } }> }> }>(
      token,
      `/history?startHistoryId=${encodeURIComponent(startHistoryId)}&historyTypes=messageAdded`,
    );
    if (status === 404) return null; // watermark too old ⇒ caller does a full resync
    if (!ok) return [];
    const ids = new Set<string>();
    for (const h of json.history ?? []) for (const m of h.messagesAdded ?? []) ids.add(m.message.id);
    return [...ids];
  }

  private async recentMessageIds(token: string): Promise<string[]> {
    const { ok, json } = await this.gmail<{ messages?: Array<{ id: string }> }>(
      token,
      `/messages?labelIds=INBOX&maxResults=25`,
    );
    return ok ? (json.messages ?? []).map((m) => m.id) : [];
  }

  private async getRaw(token: string, id: string): Promise<GmailMessage> {
    const { json } = await this.gmail<GmailMessage>(token, `/messages/${id}?format=full`);
    return json;
  }

  private async hydrate(token: string, msg: InboundMessage): Promise<InboundMessage> {
    for (const att of msg.attachments) {
      if (att.attachmentId) att.data = await this.getAttachment(msg.messageId, att.attachmentId, token);
    }
    return msg;
  }

  async fetchNewMessages(sinceWatermark: string | null): Promise<InboundMessage[]> {
    const token = await this.token();
    let ids: string[];
    if (sinceWatermark) {
      const fromHistory = await this.messageIdsFromHistory(token, sinceWatermark);
      ids = fromHistory ?? (await this.recentMessageIds(token));
    } else {
      ids = await this.recentMessageIds(token);
    }
    const out: InboundMessage[] = [];
    for (const id of ids) {
      const parsed = parseGmailMessage(await this.getRaw(token, id));
      if (this.isLoopMessage(parsed)) continue;
      out.push(await this.hydrate(token, parsed));
    }
    return out;
  }

  async getMessage(messageId: string): Promise<InboundMessage> {
    const token = await this.token();
    return this.hydrate(token, parseGmailMessage(await this.getRaw(token, messageId)));
  }

  async getAttachment(messageId: string, attachmentId: string, token?: string): Promise<Buffer> {
    const t = token ?? (await this.token());
    const { json } = await this.gmail<{ data?: string }>(t, `/messages/${messageId}/attachments/${attachmentId}`);
    return json.data ? base64UrlDecode(json.data) : Buffer.alloc(0);
  }

  async sendReply(thread: ThreadRef, reply: OutboundReply): Promise<{ messageId: string; threadId?: string }> {
    if (!thread.to) throw new Error("GoogleChannel.sendReply: missing recipient (thread.to)");
    const token = await this.token();
    const raw = buildReplyRaw({
      from: this.cfg.mailbox,
      to: thread.to,
      subject: reply.subject,
      text: reply.text,
      inReplyTo: thread.rfcMessageId,
      references: thread.references,
    });
    const { ok, status, json } = await this.gmail<{ id?: string; threadId?: string; error?: { message?: string } }>(token, `/messages/send`, {
      method: "POST",
      body: JSON.stringify({ raw, threadId: thread.threadId }),
    });
    if (!ok || !json.id) {
      throw new Error(`Gmail send failed (${status})${json.error?.message ? `: ${json.error.message}` : ""}`);
    }
    return { messageId: json.id, threadId: json.threadId };
  }

  /** Send a NEW email (not a thread reply) — used for rep-inbox escalation. */
  async sendEmail(to: string, subject: string, text: string): Promise<boolean> {
    try {
      const token = await this.token();
      const raw = buildReplyRaw({ from: this.cfg.mailbox, to, subject, text });
      const { ok } = await this.gmail(token, `/messages/send`, { method: "POST", body: JSON.stringify({ raw }) });
      return ok;
    } catch {
      return false;
    }
  }

  async markProcessed(messageId: string): Promise<void> {
    const token = await this.token();
    await this.gmail(token, `/messages/${messageId}/modify`, {
      method: "POST",
      body: JSON.stringify({ removeLabelIds: ["UNREAD"] }),
    });
  }

  async renewSubscription(): Promise<{ expiresAt: string }> {
    const token = await this.token();
    const { json } = await this.gmail<{ expiration?: string }>(token, `/watch`, {
      method: "POST",
      body: JSON.stringify({
        topicName: this.cfg.pubsubTopic,
        labelIds: ["INBOX"],
        labelFilterBehavior: "INCLUDE",
      }),
    });
    return { expiresAt: json.expiration ?? "" };
  }
}
