import { adminStatus } from "@/lib/po-agent/admin-status";
import { HealthRow } from "../ui";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const s = adminStatus();
  const yn = (b: boolean) => (b ? "yes" : "no");

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Settings &amp; status</h1>
          <p className="muted">Configuration is environment-driven (white-label posture). This is a read-only view of the effective values.</p>
        </div>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h3>Connections</h3>
          <div className="health">
            <HealthRow ok={s.store.configured} name="BigCommerce store" detail={s.store.storeHash ? `${s.store.storeHash} · channel ${s.store.channelId}` : "not configured"} />
            <HealthRow ok={s.redis} name="Redis" detail={s.redis ? "connected" : "UPSTASH_REDIS_REST_*"} />
            <HealthRow ok={s.ai.configured} name="AI model" detail={s.ai.model ?? "heuristic fallback"} warn={!s.ai.configured} />
            <HealthRow ok={s.channelCreds.google} name="Gmail channel" detail={s.channelCreds.google ? "configured" : "GOOGLE_PO_*"} warn={!s.channelCreds.google} />
            <HealthRow ok={s.channelCreds.microsoft} name="Microsoft channel" detail={s.channelCreds.microsoft ? "configured" : "MS_PO_*"} warn={!s.channelCreds.microsoft} />
            <HealthRow ok={s.escalation.slack} name="Slack escalation" detail={s.escalation.slack ? "configured" : "off"} warn={!s.escalation.slack} />
            <HealthRow ok={s.escalation.email} name="Email escalation" detail={s.escalation.email ? "configured" : "off"} warn={!s.escalation.email} />
            <HealthRow ok={s.staffGate} name="Staff gate secret" detail={s.staffGate ? "set" : "dev-open"} warn={!s.staffGate} />
          </div>
        </div>

        <div className="card">
          <h3>Behavior</h3>
          <div className="kv">
            <span className="k">Enabled</span><span>{yn(s.enabled)}</span>
            <span className="k">Mode</span><span>{s.mode}</span>
            <span className="k">Channel</span><span>{s.channel}</span>
            <span className="k">Mailbox</span><span className="mono">{s.mailbox ?? "—"}</span>
            <span className="k">Pay-on-account codes</span><span className="mono">{s.paymentCodes.join(", ")}</span>
            <span className="k">Max clarifications</span><span>{s.limits.maxClarifications}</span>
            <span className="k">Price tolerance</span><span>{s.limits.priceTolerancePct}%</span>
            <span className="k">Escalate value</span><span>${s.limits.escalateValue}</span>
            <span className="k">First-order confirm</span><span>{yn(s.limits.firstOrderConfirm)}</span>
            <span className="k">Reminder / expiry (days)</span><span>{s.limits.reminderDays} / {s.limits.sessionExpiryDays}</span>
            <span className="k">Daily submit cap</span><span>{s.limits.dailySubmitCap ?? "off"}</span>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3>How to change these</h3>
        <p className="muted">
          Set the corresponding <code>PO_AGENT_*</code> / <code>BIGCOMMERCE_*</code> environment variables
          (see <code>.env.example</code> and <code>docs/PO_AGENT.md</code>), then redeploy. Secrets are never shown here.
        </p>
      </div>
    </>
  );
}
