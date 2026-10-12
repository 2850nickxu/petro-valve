import { NextResponse } from "next/server";
import { saveSettings, EDITABLE_KEYS, type SettingsScope } from "@/lib/po-agent/settings-store";
import { sessionStoreHash } from "@/lib/bc-app/request-context";

// Persist admin-entered settings (gated by middleware). Scope = the installed store when
// opened via the app, else global (single-store deployment).

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const record: Record<string, string> = {};
  for (const k of EDITABLE_KEYS) if (k in body) record[k] = String(body[k] ?? "");

  const hash = await sessionStoreHash();
  const scope: SettingsScope = hash ? `store:${hash}` : "global";

  const ok = await saveSettings(scope, record);
  if (!ok) return NextResponse.json({ error: "Redis not configured — cannot persist settings." }, { status: 503 });
  return NextResponse.json({ ok: true, scope });
}
