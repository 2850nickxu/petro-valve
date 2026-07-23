import { NextResponse } from "next/server";
import { getPoAgentConfig } from "@/lib/po-agent/config";
import { verifyInboundSecret } from "@/lib/po-agent/security";
import { buildRuntime } from "@/lib/po-agent/runtime";
import { processInbound } from "@/lib/po-agent/pipeline";

// QStash-signed / secret-verified worker. Processes one message (by id) or syncs from the
// stored Gmail watermark. Heavy path (AI + BC calls) — generous maxDuration.

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  const config = getPoAgentConfig();
  if (!verifyInboundSecret(req, config.inboundSecret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const rt = buildRuntime();
  if (!rt.ok) return NextResponse.json({ error: rt.error }, { status: 503 });

  const body = (await req.json().catch(() => ({}))) as { messageId?: string; historyId?: string };

  if (body.messageId) {
    const msg = await rt.channel.getMessage(body.messageId);
    if (rt.channel.isLoopMessage(msg)) return NextResponse.json({ ok: true, skipped: "loop" });
    const session = await processInbound(rt.deps, msg, {});
    return NextResponse.json({ ok: true, state: session.state });
  }

  const store = rt.deps.store!;
  const watermark = await store.getGmailWatermark();
  const messages = await rt.channel.fetchNewMessages(watermark);
  const results: string[] = [];
  for (const m of messages) results.push((await processInbound(rt.deps, m, {})).state);
  if (body.historyId) await store.setGmailWatermark(String(body.historyId));
  return NextResponse.json({ ok: true, processed: results.length, results });
}
