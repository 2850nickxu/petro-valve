import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getPoAgentConfig } from "@/lib/po-agent/config";
import { effectiveEnv } from "@/lib/po-agent/effective-env";
import { verifiedStoreHash } from "@/lib/bc-app/resolve-context";
import { resolveRequestStoreContext } from "@/lib/bc-app/request-context";
import { isStaffAuthorized, staffSecret } from "@/lib/po-agent/staff-auth";
import { resolveExtractor } from "@/lib/po-agent/ai/extractor";
import { resolveChannelAdapter } from "@/lib/po-agent/runtime";
import { SimulatorChannel } from "@/lib/po-agent/channel/simulator";
import { getRedis } from "@/lib/redis";
import { createPoStore } from "@/lib/po-agent/store";
import { processInbound } from "@/lib/po-agent/pipeline";
import type { EmailChannel } from "@/lib/po-agent/channel/types";
import type { MailSender } from "@/lib/po-agent/escalate";

// Vertical-slice entrypoint: inject a PO and run the pipeline. Default is a DRY RUN
// (identify → extract → resolve → price → validate → decide → would-be action; no submit,
// no email). When SANDBOX MODE is enabled (PO_AGENT_SIMULATOR_SEND) AND the caller is
// authenticated staff AND a store context + Redis are available, it runs for REAL — placing
// an actual quote/order in the connected store (tagged "[PO agent sandbox]"). Emails are
// suppressed and captured unless PO_AGENT_SIMULATOR_SEND_EMAILS is also on. The public /demo
// (unauthenticated) can never submit — it always dry-runs.

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    from?: string;
    subject?: string;
    bodyText?: string;
    mailbox?: string;
  };
  const from = (body.from ?? "").trim();
  if (!from) {
    return NextResponse.json({ error: "Provide a sender email address (from)." }, { status: 400 });
  }

  const jar = await cookies();
  const hash = verifiedStoreHash(jar.get("poa_app")?.value);
  const env = await effectiveEnv(hash ?? undefined);
  const config = getPoAgentConfig(env);

  // Staff gate: a valid signed app-session (poa_app) OR the staff secret (poa_staff cookie /
  // ?token / Basic). Only staff may trigger real sandbox submissions; /demo stays dry-run.
  const url = new URL(req.url);
  const authz = req.headers.get("authorization") ?? "";
  const staffAuthed =
    Boolean(hash) ||
    isStaffAuthorized(
      {
        token: url.searchParams.get("token"),
        cookie: jar.get("poa_staff")?.value ?? null,
        basic: authz.startsWith("Basic ") ? authz.slice(6) : null,
      },
      staffSecret(env),
      process.env.NODE_ENV !== "production",
    );

  const simChannel = new SimulatorChannel();
  // Unique per request: a fresh SimulatorChannel always mints "sim-msg-1", so without this
  // every sandbox run collides on the same message-dedup key (poa:msg:simulator:sim-msg-1)
  // and processInbound replays the first stored session instead of re-running the pipeline.
  const message = simChannel.inject({
    from,
    subject: body.subject ?? "",
    bodyText: body.bodyText ?? "",
    messageId: `sim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  });
  const extract = resolveExtractor(env);
  const ctx = await resolveRequestStoreContext();

  if (!ctx) {
    const { extracted } = await extract(message);
    return NextResponse.json({
      storeConfigured: false,
      sandboxAvailable: config.simulatorSend,
      modelConfigured: Boolean(config.model),
      extracted,
      note: "Set BIGCOMMERCE_STORE_HASH and BIGCOMMERCE_ACCESS_TOKEN to run the full pipeline (identify, pricing, decision).",
    });
  }

  const redis = getRedis(env);
  const sandbox = config.simulatorSend && staffAuthed && Boolean(redis);

  if (sandbox && redis) {
    // Real submission against the connected store. Suppress emails (capture them) unless the
    // send-emails toggle is on and a real channel is configured.
    let channel: EmailChannel = simChannel;
    let sendMail: MailSender | undefined;
    let emailsSent = false;
    if (config.simulatorSendEmails) {
      const adapter = resolveChannelAdapter(env);
      if (!("error" in adapter)) {
        channel = adapter.channel;
        sendMail = (to, s, t) => adapter.channel.sendEmail(to, s, t);
        emailsSent = true;
      }
    }
    const session = await processInbound(
      { ctx, config, store: createPoStore(redis), channel, extract, sendMail, mailbox: body.mailbox, sandbox: true, now: () => new Date().toISOString() },
      message,
      { dryRun: false },
    );
    return NextResponse.json({
      storeConfigured: true,
      sandbox: true,
      emailsSent,
      modelConfigured: Boolean(config.model),
      session,
      captured: emailsSent ? undefined : simChannel.sent.map((c) => ({ to: c.thread.to, subject: c.reply.subject, text: c.reply.text })),
    });
  }

  const session = await processInbound(
    { ctx, config, channel: simChannel, extract, mailbox: body.mailbox },
    message,
    { dryRun: true },
  );

  return NextResponse.json({
    storeConfigured: true,
    sandbox: false,
    sandboxAvailable: config.simulatorSend,
    sandboxBlocked: config.simulatorSend && !sandbox,
    modelConfigured: Boolean(config.model),
    session,
  });
}
