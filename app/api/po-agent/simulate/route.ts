import { NextResponse } from "next/server";
import { getPoAgentConfig } from "@/lib/po-agent/config";
import { tryGetStoreContext } from "@/lib/bc/store-context";
import { resolveExtractor } from "@/lib/po-agent/ai/extractor";
import { SimulatorChannel } from "@/lib/po-agent/channel/simulator";
import { processInbound } from "@/lib/po-agent/pipeline";

// Vertical-slice entrypoint: inject a fixture PO and run the pipeline as a dry-run
// (identify → extract → resolve → price → validate → decide → would-be action). Never
// submits an order/quote and never sends email. No Gmail/Pub-Sub needed.

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

  const config = getPoAgentConfig();
  const channel = new SimulatorChannel();
  const message = channel.inject({ from, subject: body.subject ?? "", bodyText: body.bodyText ?? "" });
  const extract = resolveExtractor();
  const ctx = tryGetStoreContext();

  if (!ctx) {
    const { extracted } = await extract(message);
    return NextResponse.json({
      storeConfigured: false,
      modelConfigured: Boolean(config.model),
      extracted,
      note: "Set BIGCOMMERCE_STORE_HASH and BIGCOMMERCE_ACCESS_TOKEN to run the full pipeline (identify, pricing, decision).",
    });
  }

  const session = await processInbound(
    { ctx, config, channel, extract, mailbox: body.mailbox },
    message,
    { dryRun: true },
  );

  return NextResponse.json({
    storeConfigured: true,
    modelConfigured: Boolean(config.model),
    session,
  });
}
