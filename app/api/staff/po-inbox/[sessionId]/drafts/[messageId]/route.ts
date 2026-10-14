import { NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { createPoStore } from "@/lib/po-agent/store";
import { approveHeldDraft } from "@/lib/po-agent/rules/drafts";
import { SALES_AGENT } from "@/lib/po-agent/people";

// Approve a held draft (rules HOLD) and send it — as written, or with the operator's edits.
// Gated by middleware. Only simulated conversations hold drafts today, and those send
// through the simulator channel: captured, never emailed.

export const runtime = "nodejs";

const MAX_LEN = 8000;

export async function POST(req: Request, { params }: { params: Promise<{ sessionId: string; messageId: string }> }) {
  const { sessionId, messageId } = await params;
  const id = decodeURIComponent(sessionId);
  const body = (await req.json().catch(() => ({}))) as { text?: string; actor?: string };
  const text = body.text != null ? body.text.trim() : undefined;
  if (text !== undefined && !text) return NextResponse.json({ error: "The reply can't be empty." }, { status: 400 });
  if (text && text.length > MAX_LEN) return NextResponse.json({ error: `Reply is too long (max ${MAX_LEN} characters).` }, { status: 400 });

  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "redis unavailable" }, { status: 503 });
  const store = createPoStore(redis);
  const session = await store.loadSession(id);
  if (!session) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!session.simulated) {
    return NextResponse.json({ error: "Held drafts are only used by simulated conversations so far." }, { status: 400 });
  }

  const result = await approveHeldDraft(session, decodeURIComponent(messageId), { text, actor: body.actor?.trim() || SALES_AGENT });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  await store.saveSession(session);
  return NextResponse.json({ ok: true, session });
}
