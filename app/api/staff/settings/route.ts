import { NextResponse } from "next/server";
import { saveSettings, EDITABLE_KEYS, hiddenSettingKeys, type SettingsScope } from "@/lib/po-agent/settings-store";
import { currentAdminView, sessionStoreHash } from "@/lib/bc-app/request-context";

// Persist admin-entered settings (gated by middleware). Scope = the installed store when
// opened via the app, else global (single-store deployment).

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  // The customer view can't change what it can't see (the AI model and its keys).
  const hidden = hiddenSettingKeys(await currentAdminView());
  const record: Record<string, string> = {};
  for (const k of EDITABLE_KEYS) if (k in body && !hidden.has(k)) record[k] = String(body[k] ?? "");

  const hash = await sessionStoreHash();
  const scope: SettingsScope = hash ? `store:${hash}` : "global";

  const ok = await saveSettings(scope, record);
  if (!ok) return NextResponse.json({ error: "Redis not configured — cannot persist settings." }, { status: 503 });
  return NextResponse.json({ ok: true, scope });
}
