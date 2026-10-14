import { NextResponse } from "next/server";
import { getPoAgentConfig } from "@/lib/po-agent/config";
import { effectiveEnv } from "@/lib/po-agent/effective-env";
import { resolveRequestStoreContext, sessionStoreHash } from "@/lib/bc-app/request-context";
import { resolveExtractor } from "@/lib/po-agent/ai/extractor";
import { SimulatorChannel } from "@/lib/po-agent/channel/simulator";
import { getRedis } from "@/lib/redis";
import { createPoStore, sessionId } from "@/lib/po-agent/store";
import { getRulesConfig } from "@/lib/po-agent/rules/config";
import { resolveClassifier } from "@/lib/po-agent/rules/classify";
import { runSimulatedTurn } from "@/lib/po-agent/rules/conversation";

// Simulated email conversation, decided by the Petro Valve rules (staff only — the
// middleware gates /api/staff/**). The customer's message is injected through the
// simulator channel, so every reply is captured and never emailed.
//
//   mode "decide": classify, read, price and decide; return the decision and the reply it
//                  would send. Nothing is stored and nothing is created in the store.
//   mode "reply":  the full turn. The session is saved (marked simulated); a quote reply
//                  creates a real quote in the connected test store, tagged as a sandbox
//                  artifact. Pass the `threadId` of an earlier turn to reply on it.

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BODY = 20_000;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    from?: string;
    subject?: string;
    bodyText?: string;
    threadId?: string;
    mode?: string;
    reviewAll?: boolean;
  };
  const from = (body.from ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+$/.test(from)) {
    return NextResponse.json({ error: "Provide the customer's email address." }, { status: 400 });
  }
  const bodyText = body.bodyText ?? "";
  if (!bodyText.trim()) return NextResponse.json({ error: "Write the customer's message." }, { status: 400 });
  if (bodyText.length > MAX_BODY) return NextResponse.json({ error: `Message is too long (max ${MAX_BODY} characters).` }, { status: 400 });
  const mode = body.mode === "decide" ? "decide" : "reply";
  const threadId = body.threadId?.trim() || undefined;
  if (threadId && !/^sim-[A-Za-z0-9-]+$/.test(threadId)) {
    return NextResponse.json({ error: "threadId must be a simulator thread id (sim-…)." }, { status: 400 });
  }
  if (threadId && mode === "decide") {
    return NextResponse.json({ error: "Decide-only runs don't continue a thread." }, { status: 400 });
  }

  const hash = await sessionStoreHash();
  const env = await effectiveEnv(hash ?? undefined);
  const config = getPoAgentConfig(env);
  const rules = getRulesConfig(env, { reviewAll: Boolean(body.reviewAll) });

  const ctx = await resolveRequestStoreContext();
  if (!ctx) {
    return NextResponse.json({ error: "Connect a BigCommerce store in Settings to run the simulator." }, { status: 503 });
  }
  const redis = getRedis(env);
  if (mode === "reply" && !redis) {
    return NextResponse.json({ error: "Redis isn't configured, so a conversation can't be kept. Use Decide only." }, { status: 503 });
  }
  const store = redis ? createPoStore(redis) : undefined;
  if (threadId && !(await store!.loadSession(sessionId("simulator", threadId)))) {
    return NextResponse.json({ error: "That conversation no longer exists. Start a new one." }, { status: 404 });
  }

  const channel = new SimulatorChannel();
  const messageId = `sim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const message = channel.inject({
    from,
    subject: (body.subject ?? "").slice(0, 300),
    bodyText,
    messageId,
    threadId: threadId ?? messageId,
  });

  try {
    const turn = await runSimulatedTurn(
      {
        ctx,
        config,
        rules,
        // Decide-only uses the store only to record token usage; nothing else is saved.
        store,
        channel,
        extract: resolveExtractor(env),
        classify: resolveClassifier(env, { attempts: rules.modelRetryAttempts }),
      },
      message,
      { mode },
    );
    return NextResponse.json({
      mode,
      modelConfigured: Boolean(config.model),
      session: turn.session,
      record: turn.record,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "The simulated turn failed." }, { status: 500 });
  }
}
