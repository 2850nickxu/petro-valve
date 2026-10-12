import { headers } from "next/headers";
import { Badge } from "@/components/backbone";
import { SETTINGS_FIELDS, settingsView, type SettingsScope } from "@/lib/po-agent/settings-store";
import { sessionStoreHash } from "@/lib/bc-app/request-context";
import { listStoreInstalls } from "@/lib/bc-app/store-tokens";
import { effectiveEnv } from "@/lib/po-agent/effective-env";
import { getPoAgentConfig } from "@/lib/po-agent/config";
import { adminStatus } from "@/lib/po-agent/admin-status";
import { activeStoreSource } from "@/lib/bc-app/request-context";
import { SettingsForm, type SettingsDefaults, type SettingsHealth } from "@/components/settings-form";
import { PageHead } from "../ui";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const hash = await sessionStoreHash();
  const scope: SettingsScope = hash ? `store:${hash}` : "global";
  const env = await effectiveEnv(hash ?? undefined);
  const config = getPoAgentConfig(env);
  const status = adminStatus(env);

  const [view, installs, active] = await Promise.all([
    settingsView(scope),
    listStoreInstalls(),
    activeStoreSource(),
  ]);
  const host = (await headers()).get("host") ?? "localhost:3000";
  const origin = `https://${host}`;

  // Controls display the effective value (env + saved settings) until explicitly changed.
  const defaults: SettingsDefaults = {
    enabled: config.enabled,
    firstOrderConfirm: config.firstOrderConfirm,
    forwardPriceMismatch: config.forwardPriceMismatch,
    simulatorSend: config.simulatorSend,
    simulatorSendEmails: config.simulatorSendEmails,
    priceTolerancePct: config.priceTolerancePct,
    maxClarifications: config.maxClarifications,
    channel: config.channel === "microsoft" ? "microsoft" : "google",
  };

  const health: SettingsHealth = {
    agent: status.enabled,
    ai: status.ai.configured,
    channel: status.channelCreds.google || status.channelCreds.microsoft,
    escalation: status.escalation.email || status.escalation.slack,
    store: active.source !== "none",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--gap-section)", maxWidth: "var(--content-max-form)" }}>
      <PageHead
        title="Settings"
        sub={
          <>
            Configure the agent here — no env or CLI needed. Saved to{" "}
            <Badge tone="neutral">{scope === "global" ? "this deployment" : `store ${hash}`}</Badge>. Secrets are
            encrypted at rest.
          </>
        }
      />

      <SettingsForm
        fields={SETTINGS_FIELDS}
        view={view}
        defaults={defaults}
        health={health}
        origin={origin}
        installs={installs}
      />
    </div>
  );
}
