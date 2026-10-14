import type { EmailChannel, InboundMessage, OutboundReply, ThreadRef } from "./channel/types";
import type { MailSender } from "./escalate";
import type { MessageKind, MessagePurpose, PoSession, SessionMessage } from "./types";

// The session's message log: every email the buyer sends in and every email the agent or
// staff send out, with the exact body, so the whole conversation can be shown without
// going back to the mailbox. Append-only — ids are ordinals ("m1", "m2", …).
//
// Sends made through here never throw. A failed send is logged with status "failed", a
// send_failed audit event is written, and the caller carries on.

const TEXT_CAP = 32_000;

export function capText(text: string): string {
  return text.length > TEXT_CAP ? `${text.slice(0, TEXT_CAP)}…` : text;
}

export function reSubject(subject: string | undefined): string {
  return subject && /^re:/i.test(subject) ? subject : `Re: ${subject || "your purchase order"}`;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The session's messages without touching it: the stored log, or — for sessions saved
 * before the log existed — the retained original email as the first entry. */
export function sessionMessages(session: PoSession): SessionMessage[] {
  if (session.messages) return session.messages;
  if (!session.inbound) return [];
  return [
    {
      id: "m1",
      at: session.inbound.receivedAt ?? session.createdAt,
      direction: "in",
      audience: "buyer",
      kind: "inbound",
      status: "received",
      from: session.inbound.from,
      subject: session.inbound.subject,
      text: session.inbound.bodyText,
      run: 1,
      providerMessageId: session.messageIds[0],
      providerThreadId: session.threadId,
    },
  ];
}

/** The session's log, created on first use (back-filled as in sessionMessages). */
function log(session: PoSession): SessionMessage[] {
  if (!session.messages) session.messages = sessionMessages(session);
  return session.messages;
}

/** The latest pipeline run — what a staff or lifecycle action acts on. */
export function currentRun(session: PoSession): number {
  return Math.max(1, log(session).filter((m) => m.direction === "in").length);
}

function append(session: PoSession, msg: Omit<SessionMessage, "id">): SessionMessage {
  const messages = log(session);
  const entry: SessionMessage = { id: `m${messages.length + 1}`, ...msg };
  messages.push(entry);
  return entry;
}

function sendFailed(session: PoSession, msg: SessionMessage): void {
  session.audit.push({
    at: msg.at,
    event: "send_failed",
    detail: { messageId: msg.id, kind: msg.kind, purpose: msg.purpose, to: msg.to, error: msg.error },
    ...(msg.actor ? { actor: msg.actor } : {}),
  });
}

/** Log an inbound email once — a redelivery returns the existing entry. Its `run` is the
 * pipeline run this message triggers. */
export function recordInbound(session: PoSession, message: InboundMessage, at: string, mailbox?: string): SessionMessage {
  const messages = log(session);
  const seen = messages.find((m) => m.direction === "in" && m.providerMessageId === message.messageId);
  if (seen) return seen;
  return append(session, {
    at: message.receivedAt ?? at,
    direction: "in",
    audience: "buyer",
    kind: "inbound",
    status: "received",
    from: message.from,
    ...(mailbox ? { to: mailbox } : {}),
    subject: message.subject,
    text: capText(message.bodyText),
    ...(message.attachments.length
      ? { attachments: message.attachments.map((a) => ({ filename: a.filename, mediaType: a.mediaType, size: a.data.byteLength })) }
      : {}),
    run: messages.filter((m) => m.direction === "in").length + 1,
    providerMessageId: message.messageId,
    providerThreadId: message.threadId,
    rfcMessageId: message.headers?.["message-id"],
    references: message.headers?.["references"],
  });
}

export interface SendMeta {
  kind: MessageKind;
  purpose?: MessagePurpose;
  /** The monitored mailbox the email is sent from, when known. */
  from?: string;
  run?: number;
  actor?: string;
}

/** Send a reply on the buyer's thread and log it. Never throws: check `status`. */
export async function sendRecordedReply(
  channel: EmailChannel,
  session: PoSession,
  thread: ThreadRef,
  reply: OutboundReply,
  meta: SendMeta,
  now: () => string,
): Promise<SessionMessage> {
  const base = {
    direction: "out",
    audience: "buyer",
    kind: meta.kind,
    purpose: meta.purpose,
    from: meta.from,
    to: thread.to,
    subject: reply.subject,
    text: capText(reply.text),
    run: meta.run,
    actor: meta.actor,
  } as const;
  try {
    const sent = await channel.sendReply(thread, reply);
    return append(session, {
      ...base,
      at: now(),
      status: channel.id === "simulator" ? "captured" : "sent",
      providerMessageId: sent.messageId,
      providerThreadId: sent.threadId ?? thread.threadId,
    });
  } catch (err) {
    const entry = append(session, { ...base, at: now(), status: "failed", error: errorText(err) });
    sendFailed(session, entry);
    return entry;
  }
}

/** Wrap a MailSender so every internal email it sends (rep escalation, below-contract
 * forward) is logged on the session. The wrapped sender never throws. `onRecord` sees each
 * logged entry, so the pipeline can write its outbound decision step. */
export function recordedMailer(
  send: MailSender,
  session: PoSession,
  meta: { kind: MessageKind; from?: string; run?: number; captured: boolean },
  now: () => string,
  onRecord?: (entry: SessionMessage) => void,
): MailSender {
  return async (to, subject, text) => {
    let ok = false;
    let error: string | undefined;
    try {
      ok = await send(to, subject, text);
      if (!ok) error = "The mail provider rejected the send.";
    } catch (err) {
      error = errorText(err);
    }
    const entry = append(session, {
      at: now(),
      direction: "out",
      audience: "internal",
      kind: meta.kind,
      status: ok ? (meta.captured ? "captured" : "sent") : "failed",
      from: meta.from,
      to,
      subject,
      text: capText(text),
      run: meta.run,
      ...(error ? { error } : {}),
    });
    if (!ok) sendFailed(session, entry);
    onRecord?.(entry);
    return ok;
  };
}

/** Thread reference for a reply sent outside the pipeline (staff reply, lifecycle nudge),
 * aimed at the buyer's newest message so In-Reply-To/References and Graph /reply thread
 * correctly. The subject repeats the original so Gmail keeps it on the same thread. */
export function replyThread(session: PoSession, to: string | undefined): ThreadRef {
  const lastIn = [...log(session)].reverse().find((m) => m.direction === "in");
  return {
    threadId: session.threadId,
    inReplyToMessageId: lastIn?.providerMessageId ?? session.messageIds[session.messageIds.length - 1],
    rfcMessageId: lastIn?.rfcMessageId,
    references: lastIn?.references,
    to,
    subject: reSubject(session.inbound?.subject ?? lastIn?.subject),
  };
}

/** Log a drafted reply that is held for a person to approve — not sent (rules HOLD). */
export function recordDraft(
  session: PoSession,
  thread: ThreadRef,
  reply: OutboundReply,
  meta: SendMeta,
  now: () => string,
): SessionMessage {
  return append(session, {
    at: now(),
    direction: "out",
    audience: "buyer",
    kind: meta.kind,
    purpose: meta.purpose,
    status: "held",
    from: meta.from,
    to: thread.to,
    subject: reply.subject,
    text: capText(reply.text),
    run: meta.run,
  });
}

/** Send a held draft, optionally edited, and mark it sent in place. Never throws: check
 * `status`. Returns null when there's no held draft with that id. */
export async function sendHeldDraft(
  channel: EmailChannel,
  session: PoSession,
  messageId: string,
  opts: { text?: string; actor?: string },
  now: () => string,
): Promise<SessionMessage | null> {
  const msg = log(session).find((m) => m.id === messageId && m.status === "held");
  if (!msg) return null;
  const text = opts.text != null ? capText(opts.text) : msg.text;
  const thread = replyThread(session, msg.to);
  msg.text = text;
  msg.actor = opts.actor;
  msg.at = now();
  try {
    const sent = await channel.sendReply(thread, { subject: msg.subject, text });
    msg.status = channel.id === "simulator" ? "captured" : "sent";
    msg.providerMessageId = sent.messageId;
    msg.providerThreadId = sent.threadId ?? thread.threadId;
  } catch (err) {
    msg.status = "failed";
    msg.error = errorText(err);
    sendFailed(session, msg);
  }
  return msg;
}
