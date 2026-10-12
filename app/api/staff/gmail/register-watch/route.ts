import { NextResponse } from "next/server";
import { buildRuntime } from "@/lib/po-agent/runtime";
import { sessionStoreHash } from "@/lib/bc-app/request-context";

// Register/renew the Gmail users.watch subscription using the configured channel + Pub/Sub
// topic (gated by middleware).

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST() {
  const hash = await sessionStoreHash();
  const rt = await buildRuntime(process.env, hash ?? undefined);
  if (!rt.ok) return NextResponse.json({ error: rt.error }, { status: 503 });
  try {
    const { expiresAt } = await rt.channel.renewSubscription();
    return NextResponse.json({ ok: true, expiresAt });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message.slice(0, 180) : "failed" }, { status: 500 });
  }
}
