import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { getRedis } from "@/lib/redis";
import { createPoStore } from "@/lib/po-agent/store";
import { adminStatus, isOperational } from "@/lib/po-agent/admin-status";
import { effectiveEnv } from "@/lib/po-agent/effective-env";
import { verifiedStoreHash } from "@/lib/bc-app/resolve-context";
import { activeStoreSource } from "@/lib/bc-app/request-context";
import { AdminNav } from "./nav";

export const dynamic = "force-dynamic";

export default async function StaffLayout({ children }: { children: ReactNode }) {
  const hash = verifiedStoreHash((await cookies()).get("poa_app")?.value);
  const status = adminStatus(await effectiveEnv(hash ?? undefined));
  const active = await activeStoreSource();
  const operational = isOperational(status);

  let escalated = 0;
  const redis = getRedis();
  if (redis) escalated = (await createPoStore(redis).listQueue("escalated", 100)).length;

  return (
    <div className="app">
      <div className="app-gradient" />
      <header className="app-header">
        <img className="app-logo" src="/silk-logo-color.svg" alt="Silk Commerce" />
        <span className="app-divider" />
        <span className="app-title">PO Agent</span>
        {active.storeHash && (
          <span className="muted" style={{ fontSize: 12 }}>
            store <span className="mono">{active.storeHash}</span>
          </span>
        )}
        <div className="app-header-right">
          <span className={`pill ${operational ? "ok" : "muted"}`}>
            {operational ? "Operational" : status.enabled ? "Setup" : "Disabled"}
          </span>
          <span className="muted" style={{ fontSize: 12 }}>mode: {status.mode} · {status.channel}</span>
          <Link className="btn primary" href="/staff/simulator">Open simulator</Link>
        </div>
      </header>
      <div className="app-body">
        <aside className="app-sidebar">
          <AdminNav escalated={escalated} />
        </aside>
        <main className="app-main">{children}</main>
      </div>
    </div>
  );
}
