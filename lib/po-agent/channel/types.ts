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
  inReplyToMessageId?: string;
  references?: string;
  subject?: string;
}

export interface EmailChannel {
  id: "google" | "microsoft" | "simulator";
  fetchNewMessages(sinceWatermark: string | null): Promise<InboundMessage[]>;
  getMessage(messageId: string): Promise<InboundMessage>;
  getAttachment(messageId: string, attachmentId: string): Promise<Buffer>;
  sendReply(thread: ThreadRef, reply: OutboundReply): Promise<{ messageId: string }>;
  markProcessed(messageId: string): Promise<void>;
  renewSubscription(): Promise<{ expiresAt: string }>;
}

/** Pluggable extraction: real LLM (ai/extract) or the zero-cred heuristic. */
export type Extractor = (
  msg: InboundMessage,
  prior?: { priorExtraction?: ExtractedPo; buyerReply?: string },
) => Promise<{ extracted: ExtractedPo; notes: string[] }>;
