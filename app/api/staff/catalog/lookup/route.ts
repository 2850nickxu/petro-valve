import { NextResponse } from "next/server";
import { getPoAgentConfig } from "@/lib/po-agent/config";
import { effectiveEnv } from "@/lib/po-agent/effective-env";
import { sessionStoreHash } from "@/lib/bc-app/request-context";
import { tryGetMagentoContext } from "@/lib/magento/magento-context";
import { resolveSkus } from "@/lib/magento/sku-resolver";
import { lookupRow } from "@/lib/magento/lookup";

// Catalog lookup for the staff Catalog page (gated by middleware). Read-only: SKU matching
// against the connected Magento store, the same resolver the agent uses on PO lines.

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_LINES = 50;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { lines?: Array<{ input?: string; qty?: number | null }> };
  const lines = (body.lines ?? [])
    .map((l) => ({ input: (l.input ?? "").trim().slice(0, 120), qty: Number.isInteger(l.qty) && l.qty! > 0 ? l.qty! : null }))
    .filter((l) => l.input);
  if (!lines.length) return NextResponse.json({ error: "Enter at least one SKU." }, { status: 400 });
  if (lines.length > MAX_LINES) return NextResponse.json({ error: `Look up at most ${MAX_LINES} lines at a time.` }, { status: 400 });

  const env = await effectiveEnv((await sessionStoreHash()) ?? undefined);
  if (getPoAgentConfig(env).commerce !== "magento") {
    return NextResponse.json({ error: "Catalog lookup is for Magento stores. Set the commerce platform in Settings → Store." }, { status: 400 });
  }
  const ctx = tryGetMagentoContext(env);
  if (!ctx) return NextResponse.json({ error: "Connect the Magento store in Settings → Store." }, { status: 503 });

  try {
    const found = await resolveSkus(ctx, lines.map((l) => l.input), { withAttributes: true });
    return NextResponse.json({ rows: lines.map((l) => lookupRow(l.input, l.qty, found.get(l.input))) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message.slice(0, 200) : "Lookup failed." }, { status: 502 });
  }
}
