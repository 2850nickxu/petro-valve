import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { generateText } from "ai";
import { effectiveEnv } from "@/lib/po-agent/effective-env";
import { verifiedStoreHash, resolveStoreContextForHash } from "@/lib/bc-app/resolve-context";
import { bcFetch } from "@/lib/bc/bc-client";
import { poModel } from "@/lib/po-agent/ai/registry";
import { postSlack } from "@/lib/po-agent/escalate/slack";
import { mintAccessToken, googleCredsFromEnv } from "@/lib/po-agent/channel/google-auth";
import { mintGraphToken, msCredsFromEnv } from "@/lib/po-agent/channel/microsoft";

// Validate a configured connection (gated by middleware). Tests the merged effective env
// plus any unsaved form values so an admin can verify before/after saving.

export const runtime = "nodejs";
export const maxDuration = 30;

const done = (ok: boolean, detail: string) => NextResponse.json({ ok, detail });

export async function POST(req: Request) {
  const { target, values } = (await req.json().catch(() => ({}))) as { target?: string; values?: Record<string, string> };
  const hash = verifiedStoreHash((await cookies()).get("poa_app")?.value);
  const env = { ...(await effectiveEnv(hash ?? undefined)), ...(values ?? {}) };

  try {
    switch (target) {
      case "bigcommerce": {
        const ctx = await resolveStoreContextForHash(hash ?? null, env);
        if (!ctx) return done(false, "No store hash/token configured.");
        const store = await bcFetch<{ name?: string; features?: unknown }>(ctx, "/v2/store");
        return done(true, `Connected to “${store.name ?? ctx.storeHash}”.`);
      }
      case "ai": {
        const model = env.PO_AGENT_MODEL;
        if (!model) return done(false, "Set a model (provider:model-id).");
        const result = await generateText({ model: poModel(model, env), prompt: "Reply with the single word: ok", maxOutputTokens: 8 });
        return done(true, `Model responded: “${result.text.trim().slice(0, 40)}”.`);
      }
      case "slack": {
        const url = env.PO_AGENT_SLACK_WEBHOOK_URL;
        if (!url) return done(false, "No Slack webhook URL.");
        const posted = await postSlack(url, "PO Agent — test message ✅");
        return done(posted, posted ? "Posted a test message to Slack." : "Slack rejected the webhook.");
      }
      case "gmail": {
        const creds = googleCredsFromEnv(env);
        if (!creds) return done(false, "Missing Gmail client id / secret / refresh token.");
        const token = await mintAccessToken(creds);
        return done(Boolean(token), token ? "Minted a Gmail access token." : "Could not mint a token — check the credentials.");
      }
      case "microsoft": {
        const creds = msCredsFromEnv(env);
        if (!creds) return done(false, "Missing Microsoft tenant / client id / secret.");
        const token = await mintGraphToken(creds);
        return done(Boolean(token), token ? "Minted a Graph token." : "Could not mint a token — check the credentials.");
      }
      default:
        return done(false, "Unknown test target.");
    }
  } catch (e) {
    return done(false, e instanceof Error ? e.message.slice(0, 180) : "Test failed.");
  }
}
