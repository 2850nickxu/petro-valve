import type { ReactNode } from "react";
import { getRedis } from "@/lib/redis";
import { createPoStore } from "@/lib/po-agent/store";
import { adminStatus, isOperational } from "@/lib/po-agent/admin-status";
import { effectiveEnv } from "@/lib/po-agent/effective-env";
import { sessionStoreHash } from "@/lib/bc-app/request-context";
import { AppShell, type ShellStatus } from "./shell";

export const dynamic = "force-dynamic";

export default async function StaffLayout({ children }: { children: ReactNode }) {
  const hash = await sessionStoreHash();
  const status = adminStatus(await effectiveEnv(hash ?? undefined));

  let escalated = 0;
  const redis = getRedis();
  if (redis) escalated = (await createPoStore(redis).listQueue("escalated", 100)).length;

  // The header's one-line health summary: state · channel · extractor.
  const state = isOperational(status) ? "live" : status.enabled ? "setup" : "off";
  const channel = status.channelCreds.google ? "gmail" : status.channelCreds.microsoft ? "microsoft" : "no channel";
  const model = status.ai.configured && status.ai.model ? status.ai.model : "heuristic";
  const shellStatus: ShellStatus = {
    tone: isOperational(status) ? "ok" : status.enabled ? "warn" : "bad",
    label: `${state} · ${channel} · ${model}`,
  };

  return (
    <AppShell escalated={escalated} status={shellStatus}>
      {children}
    </AppShell>
  );
}
