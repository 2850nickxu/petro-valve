import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getRedis } from "@/lib/redis";
import { createPoStore } from "@/lib/po-agent/store";
import { effectiveEnv } from "@/lib/po-agent/effective-env";
import { verifiedStoreHash } from "@/lib/bc-app/resolve-context";
import { resolveChannelAdapter } from "@/lib/po-agent/runtime";
import type { ThreadRef } from "@/lib/po-agent/channel/types";

// Staff reply-on-thread (gated by middleware). Sends an operator-authored message to the
// buyer on the SAME email thread as the original PO, from the monitored mailbox, and
// records it in the audit trail.
//
// The text is supplied verbatim by the operator — the model is not in this path, so no
// generated prose or invented figures can reach a buyer. Sending is code-driven and the
// session's state is deliberately NOT changed: a reply is a nudge, not a decision. The
// session stays in the queue until staff force an order/quote or dismiss it.

export const runtime = "nodejs";

const MAX_LEN = 8000;

export async function POST(req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const id = decodeURIComponent(sessionId);

  const body = (await req.json().catch(() => ({}))) as { text?: string; actor?: string };
  const text = (body.text ?? "").trim();
  if (!text) return NextResponse.json({ error: "A reply body is required." }, { status: 400 });
  if (text.length > MAX_LEN) {
    return NextResponse.json({ error: `Reply is too long (max ${MAX_LEN} characters).` }, { status: 400 });
  }

  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "redis unavailable" }, { status: 503 });
  const store = createPoStore(redis);
  const session = await store.loadSession(id);
  if (!session) return NextResponse.json({ error: "not found" }, { status: 404 });

  const to = session.buyer?.email ?? session.inbound?.from;
  if (!to) {
    return NextResponse.json({ error: "This session has no known buyer address to reply to." }, { status: 400 });
  }

  const hash = verifiedStoreHash((await cookies()).get("poa_app")?.value);
  const env = await effectiveEnv(hash ?? undefined);
  const adapter = resolveChannelAdapter(env);
  if ("error" in adapter) return NextResponse.json({ error: adapter.error }, { status: 503 });

  const subject = session.inbound?.subject
    ? /^re:/i.test(session.inbound.subject)
      ? session.inbound.subject
      : `Re: ${session.inbound.subject}`
    : "Re: your purchase order";

  // Reply against the newest message we've seen on the thread so clients nest it correctly.
  const thread: ThreadRef = {
    threadId: session.threadId,
    inReplyToMessageId: session.messageIds[session.messageIds.length - 1],
    to,
    subject,
  };

  let messageId: string;
  try {
    const sent = await adapter.channel.sendReply(thread, { subject, text });
    messageId = sent.messageId;
  } catch (err) {
    return NextResponse.json(
      { error: `Send failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }

  const actor = body.actor?.trim() || "staff";
  const preview = text.length > 52 ? `${text.slice(0, 52)}…` : text;
  session.audit.push({
    at: new Date().toISOString(),
    event: "replied",
    actor,
    note: text,
    detail: { to, messageId, preview, via: adapter.mailbox || adapter.channel.id },
  });
  session.updatedAt = new Date().toISOString();
  await store.saveSession(session);

  return NextResponse.json({ ok: true, messageId, state: session.state });
}
