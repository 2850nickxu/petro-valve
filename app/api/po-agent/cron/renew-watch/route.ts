import { NextResponse } from "next/server";
import { getPoAgentConfig } from "@/lib/po-agent/config";
import { verifyInboundSecret } from "@/lib/po-agent/security";
import { buildRuntime } from "@/lib/po-agent/runtime";

// Daily cron: renew the Gmail users.watch subscription (must be renewed at least every
// 7 days). Secret = PO_AGENT_INBOUND_SECRET (Vercel cron sends it as a Bearer).

export const runtime = "nodejs";

export async function GET(req: Request) {
  const config = getPoAgentConfig();
  if (!verifyInboundSecret(req, config.inboundSecret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const rt = buildRuntime();
  if (!rt.ok) return NextResponse.json({ error: rt.error }, { status: 503 });

  const { expiresAt } = await rt.channel.renewSubscription();
  return NextResponse.json({ ok: true, expiresAt });
}
