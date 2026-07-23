import type { EmailChannel, InboundMessage, OutboundReply, ThreadRef } from "./types";

// In-memory EmailChannel for the demo simulator and tests. No network. Replies are
// captured (never actually sent) so the demo can visualize what the agent would send.

export interface CapturedReply {
  thread: ThreadRef;
  reply: OutboundReply;
  messageId: string;
}

export class SimulatorChannel implements EmailChannel {
  readonly id = "simulator" as const;
  readonly sent: CapturedReply[] = [];
  private readonly inbox = new Map<string, InboundMessage>();
  private counter = 0;

  /** Build (and store) an inbound message from a minimal spec. */
  inject(spec: {
    from: string;
    subject?: string;
    bodyText?: string;
    threadId?: string;
    messageId?: string;
    attachments?: InboundMessage["attachments"];
  }): InboundMessage {
    const messageId = spec.messageId ?? `sim-msg-${++this.counter}`;
    const threadId = spec.threadId ?? messageId;
    const msg: InboundMessage = {
      messageId,
      threadId,
      from: spec.from,
      subject: spec.subject ?? "",
      bodyText: spec.bodyText ?? "",
      attachments: spec.attachments ?? [],
    };
    this.inbox.set(messageId, msg);
    return msg;
  }

  async fetchNewMessages(): Promise<InboundMessage[]> {
    return [];
  }

  async getMessage(messageId: string): Promise<InboundMessage> {
    const msg = this.inbox.get(messageId);
    if (!msg) throw new Error(`SimulatorChannel: unknown message ${messageId}`);
    return msg;
  }

  async getAttachment(messageId: string, attachmentId: string): Promise<Buffer> {
    const msg = this.inbox.get(messageId);
    const att = msg?.attachments.find((a) => a.attachmentId === attachmentId);
    if (!att) throw new Error(`SimulatorChannel: unknown attachment ${attachmentId}`);
    return Buffer.from(att.data);
  }

  async sendReply(thread: ThreadRef, reply: OutboundReply): Promise<{ messageId: string }> {
    const messageId = `sim-reply-${++this.counter}`;
    this.sent.push({ thread, reply, messageId });
    return { messageId };
  }

  async sendEmail(to: string, subject: string, text: string): Promise<boolean> {
    this.sent.push({ thread: { threadId: "", to, subject }, reply: { subject, text }, messageId: `sim-mail-${++this.counter}` });
    return true;
  }

  isLoopMessage(): boolean {
    return false;
  }

  async markProcessed(): Promise<void> {
    /* no-op */
  }

  async renewSubscription(): Promise<{ expiresAt: string }> {
    return { expiresAt: "never" };
  }
}
