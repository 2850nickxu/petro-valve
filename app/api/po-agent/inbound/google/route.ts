import { NextResponse, after } from "next/server";
import { getPoAgentConfig } from "@/lib/po-agent/config";
import { verifyInboundSecret, decodePubSubGmail } from "@/lib/po-agent/security";
import { buildRuntime } from "@/lib/po-agent/runtime";
import { processInbound } from "@/lib/po-agent/pipeline";

// Gmail → Cloud Pub/Sub push receiver. Verify (?token=secret), ACK 200 fast, then do the
// heavy sync in the background (after()). Redelivery is safe (message-level dedupe).

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const config = getPoAgentConfig();
  if (!verifyInboundSecret(req, config.inboundSecret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const note = decodePubSubGmail(body);

  const rt = await buildRuntime();
  if (rt.ok) {
    const store = rt.deps.store!;
    await store.setLastPushAt(new Date().toISOString());
    after(async () => {
      const watermark = await store.getGmailWatermark();
      const messages = await rt.channel.fetchNewMessages(watermark);
      for (const m of messages) await processInbound(rt.deps, m, {});
      if (note?.historyId) await store.setGmailWatermark(String(note.historyId));
    });
  }

  // Always ack quickly so Pub/Sub doesn't redeliver on a slow worker.
  return NextResponse.json({ ok: true });
}
