import type { ExtractedPo } from "../types";

// Email channel abstraction — one interface for Google (Gmail) and Microsoft (Graph),
// plus an in-memory simulator for the demo/tests.

export interface Attachment {
  attachmentId?: string;
  filename: string;
  mediaType: string;
  data: Buffer | Uint8Array;
}

export interface InboundMessage {
  messageId: string;
  threadId: string;
  from: string;
  subject: string;
  bodyText: string;
  attachments: Attachment[];
  receivedAt?: string;
  headers?: Record<string, string>;
}

export interface OutboundReply {
  subject: string;
  text: string;
  html?: string;
}

export interface ThreadRef {
  threadId: string;
  /** Provider message id being replied to. */
  inReplyToMessageId?: string;
  /** RFC-2822 Message-ID header of the message being replied to (for In-Reply-To). */
  rfcMessageId?: string;
  references?: string;
  /** Recipient of the reply (the buyer). */
  to?: string;
  subject?: string;
}

export interface EmailChannel {
  id: "google" | "microsoft" | "simulator";
  fetchNewMessages(sinceWatermark: string | null): Promise<InboundMessage[]>;
  getMessage(messageId: string): Promise<InboundMessage>;
  getAttachment(messageId: string, attachmentId: string): Promise<Buffer>;
  sendReply(thread: ThreadRef, reply: OutboundReply): Promise<{ messageId: string }>;
  /** Send a NEW email (not a thread reply) — for rep-inbox escalation. */
  sendEmail(to: string, subject: string, text: string): Promise<boolean>;
  markProcessed(messageId: string): Promise<void>;
  renewSubscription(): Promise<{ expiresAt: string }>;
  /** True when a message is the agent's own send or an auto-reply (skip it). */
  isLoopMessage(msg: InboundMessage): boolean;
}

/** Pluggable extraction: real LLM (ai/extract) or the zero-cred heuristic. */
export type Extractor = (
  msg: InboundMessage,
  prior?: { priorExtraction?: ExtractedPo; buyerReply?: string },
) => Promise<{ extracted: ExtractedPo; notes: string[] }>;
