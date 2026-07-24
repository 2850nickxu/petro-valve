import { NextResponse, after } from "next/server";
import { getPoAgentConfig } from "@/lib/po-agent/config";
import { verifyInboundSecret } from "@/lib/po-agent/security";
import { buildRuntime } from "@/lib/po-agent/runtime";
import { processInbound } from "@/lib/po-agent/pipeline";

// Microsoft Graph change-notification webhook. Echoes the validationToken within the
// 10s window on subscription creation, then processes notifications (verified via
// clientState = PO_AGENT_INBOUND_SECRET). ACK 202 fast; work in the background.

export const runtime = "nodejs";
export const maxDuration = 60;

interface GraphNotification {
  clientState?: string;
  resourceData?: { id?: string };
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const validationToken = url.searchParams.get("validationToken");
  if (validationToken) {
    return new Response(validationToken, { status: 200, headers: { "Content-Type": "text/plain" } });
  }

  const config = getPoAgentConfig();
  const body = (await req.json().catch(() => ({}))) as { value?: GraphNotification[] };
  const notifications = Array.isArray(body.value) ? body.value : [];

  const clientStateOk =
    Boolean(config.inboundSecret) && notifications.length > 0 && notifications.every((n) => n.clientState === config.inboundSecret);
  if (!clientStateOk && !verifyInboundSecret(req, config.inboundSecret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const rt = await buildRuntime();
  if (rt.ok) {
    const messageIds = notifications.map((n) => n.resourceData?.id).filter((v): v is string => Boolean(v));
    after(async () => {
      for (const mid of messageIds) {
        const msg = await rt.channel.getMessage(mid);
        if (rt.channel.isLoopMessage(msg)) continue;
        await processInbound(rt.deps, msg, {});
      }
    });
  }

  return NextResponse.json({ ok: true }, { status: 202 });
}
