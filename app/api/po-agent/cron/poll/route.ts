import { NextResponse } from "next/server";
import { getPoAgentConfig } from "@/lib/po-agent/config";
import { verifyInboundSecret } from "@/lib/po-agent/security";
import { buildRuntime } from "@/lib/po-agent/runtime";
import { processInbound } from "@/lib/po-agent/pipeline";
import { sweepLifecycle } from "@/lib/po-agent/lifecycle";

// Polling fallback + lifecycle sweep. No-op sync when a Pub/Sub push arrived recently;
// otherwise it does a full history sync. Always runs the nudge/expiry sweep.

export const runtime = "nodejs";
export const maxDuration = 300;

const PUSH_HEALTHY_MS = 10 * 60 * 1000;

export async function GET(req: Request) {
  const config = getPoAgentConfig();
  if (!verifyInboundSecret(req, config.inboundSecret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const rt = await buildRuntime();
  if (!rt.ok) return NextResponse.json({ error: rt.error }, { status: 503 });
  const store = rt.deps.store!;

  const sweep = await sweepLifecycle({ config, store, channel: rt.channel, mailbox: rt.deps.mailbox, now: () => new Date().toISOString() });

  const lastPushAt = await store.getLastPushAt();
  const pushHealthy = lastPushAt != null && Date.now() - Date.parse(lastPushAt) < PUSH_HEALTHY_MS;
  if (pushHealthy) {
    return NextResponse.json({ ok: true, skipped: "push healthy", sweep });
  }

  const watermark = await store.getGmailWatermark();
  const messages = await rt.channel.fetchNewMessages(watermark);
  const results: string[] = [];
  for (const m of messages) results.push((await processInbound(rt.deps, m, {})).state);
  return NextResponse.json({ ok: true, processed: results.length, sweep });
}
