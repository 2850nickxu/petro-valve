import { NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { createPoStore } from "@/lib/po-agent/store";
import { effectiveEnv } from "@/lib/po-agent/effective-env";
import { sessionStoreHash } from "@/lib/bc-app/request-context";
import { resolveChannelAdapter } from "@/lib/po-agent/runtime";
import { SimulatorChannel } from "@/lib/po-agent/channel/simulator";
import type { EmailChannel } from "@/lib/po-agent/channel/types";
import { currentRun, replyThread, sendRecordedReply } from "@/lib/po-agent/messages";
import { repliedStep } from "@/lib/po-agent/decision-steps";
import { SALES_AGENT } from "@/lib/po-agent/people";

// Staff reply-on-thread (gated by middleware). Sends an operator-authored message to the
// buyer on the SAME email thread as the original PO, from the monitored mailbox, and
// records it in the message log and the audit trail. A failed send is logged too.
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

  // A simulator session's buyer isn't real: the reply is captured, never emailed.
  let channel: EmailChannel;
  let mailbox: string | undefined;
  if (session.simulated || session.channel === "simulator") {
    channel = new SimulatorChannel();
  } else {
    const hash = await sessionStoreHash();
    const env = await effectiveEnv(hash ?? undefined);
    const adapter = resolveChannelAdapter(env);
    if ("error" in adapter) return NextResponse.json({ error: adapter.error }, { status: 503 });
    channel = adapter.channel;
    mailbox = adapter.mailbox || undefined;
  }

  // Reply against the newest message we've seen on the thread so clients nest it correctly.
  const thread = replyThread(session, to);
  const actor = body.actor?.trim() || SALES_AGENT;
  const now = () => new Date().toISOString();

  const sent = await sendRecordedReply(
    channel,
    session,
    thread,
    { subject: thread.subject!, text },
    { kind: "staff_reply", from: mailbox, actor },
    now,
  );
  session.updatedAt = now();

  if (sent.status === "failed") {
    await store.saveSession(session);
    return NextResponse.json({ error: `Send failed: ${sent.error}` }, { status: 502 });
  }

  const messageId = sent.providerMessageId;
  const preview = text.length > 52 ? `${text.slice(0, 52)}…` : text;
  session.audit.push({
    at: now(),
    ...repliedStep(actor, sent),
    run: currentRun(session),
    actor,
    note: text,
    detail: { to, messageId, preview, via: mailbox || channel.id },
  });
  // A person has taken over the thread: the rules won't answer it again (T6).
  if (session.rules) session.rules.humanOwned = true;
  await store.saveSession(session);

  return NextResponse.json({ ok: true, messageId, state: session.state });
}
