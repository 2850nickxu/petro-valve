import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getRedis } from "@/lib/redis";
import { createPoStore } from "@/lib/po-agent/store";
import { getPoAgentConfig } from "@/lib/po-agent/config";
import { effectiveEnv } from "@/lib/po-agent/effective-env";
import { verifiedStoreHash } from "@/lib/bc-app/resolve-context";
import { resolveRequestStoreContext } from "@/lib/bc-app/request-context";
import { identify } from "@/lib/po-agent/core/identify";
import { resolveChannel } from "@/lib/po-agent/core/channel";
import { evaluate } from "@/lib/po-agent/pipeline";
import { currentRun } from "@/lib/po-agent/messages";
import { evaluationSteps, reprocessedStep } from "@/lib/po-agent/decision-steps";

// Staff re-evaluation: re-run the deterministic stages (resolve → price → validate → decide)
// from the stored extraction against current store state — for when a config/pricing fix
// should let a stuck session proceed. Never submits or emails; leaves the session where it
// is so staff can Force order/quote after reviewing the fresh decision.

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const id = decodeURIComponent(sessionId);

  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "redis unavailable" }, { status: 503 });
  const store = createPoStore(redis);
  const session = await store.loadSession(id);
  if (!session) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!session.buyer || !session.extracted) {
    return NextResponse.json({ error: "session has no identified buyer or extracted PO to re-evaluate" }, { status: 400 });
  }

  const ctx = await resolveRequestStoreContext();
  if (!ctx) return NextResponse.json({ error: "BigCommerce store context not configured" }, { status: 503 });

  const { actor } = (await req.json().catch(() => ({}))) as { actor?: string };
  const now = new Date().toISOString();

  const jar = await cookies();
  const hash = verifiedStoreHash(jar.get("poa_app")?.value);
  const config = getPoAgentConfig(await effectiveEnv(hash ?? undefined));

  // Re-identify + re-resolve channel so entitlements/approval reflect current store state.
  const idres = await identify(ctx, session.buyer.email);
  if (!idres.buyer) {
    return NextResponse.json({ error: "buyer no longer resolves in BigCommerce" }, { status: 400 });
  }
  const channel = resolveChannel({
    channelMap: config.channelMap,
    fallbackChannelId: ctx.channelId,
    mailbox: undefined,
    buyer: idres.buyer,
  });

  const evaluated = await evaluate(
    { ctx, config },
    {
      idres,
      channelId: session.channelId ?? channel.channelId,
      channelAmbiguous: channel.ambiguous,
      channelAccessDenied: channel.accessDenied,
      extracted: session.extracted,
      clarificationRounds: session.clarificationRounds,
    },
  );

  const { resolved, issues, decision } = evaluated;

  session.buyer = idres.buyer;
  session.resolution = resolved;
  session.validation = issues;
  session.decision = decision;
  // The re-run's own resolve → decide steps follow the human step, under the latest run.
  const run = currentRun(session);
  const by = actor ?? "staff";
  session.audit.push({ at: now, ...reprocessedStep(by, decision), run, actor: by });
  for (const step of evaluationSteps(evaluated, config, { clarificationRounds: session.clarificationRounds, readAt: now })) {
    session.audit.push({ at: now, ...step, run });
  }
  await store.saveSession(session);

  return NextResponse.json({ ok: true, state: session.state, decision });
}
