import { PageBody, Panel } from "@/components/backbone";
import { PageHead } from "@/app/staff/ui";
import { LinkButton } from "@/components/ui/link-button";

const frame: React.CSSProperties = {
  minHeight: "100vh",
  background: "var(--surface-page)",
  display: "flex",
  flexDirection: "column",
  fontFamily: "var(--font-ui)",
  color: "var(--text-primary)",
};

const header: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  height: "var(--control-h-header)",
  padding: "0 var(--page-pad)",
  background: "var(--surface-panel)",
  borderBottom: "var(--border-w) solid var(--border-default)",
};

export default function Home() {
  return (
    <div style={frame}>
      <header style={header}>
        <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: "-0.01em" }}>PO Agent</span>
      </header>

      <main style={{ maxWidth: "var(--content-max)", margin: "0 auto", width: "100%", padding: "var(--page-pad)" }}>
        <PageBody>
          <PageHead
            title="Offline PO Agent"
            sub="Email-first purchase-order processing for BigCommerce B2B Edition. Buyers email a PO; the agent identifies the buyer, parses it, enforces B2B controls, and submits an order (pay-on-account) or a quote with a checkout link."
          />

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "var(--gap-group)", alignItems: "start" }}>
            <Panel title="Admin console" bodyStyle={{ gap: "var(--gap-group)" }}>
              <span style={{ color: "var(--text-secondary)" }}>Dashboard, review queue, sessions, simulator, and settings.</span>
              <span>
                <LinkButton href="/staff" variant="primary" iconAfter="arrow-right">Open admin</LinkButton>
              </span>
            </Panel>
            <Panel title="Public demo" bodyStyle={{ gap: "var(--gap-group)" }}>
              <span style={{ color: "var(--text-secondary)" }}>Paste a PO and watch the pipeline run — no credentials needed.</span>
              <span>
                <LinkButton href="/demo" variant="secondary" iconAfter="arrow-right">Open demo</LinkButton>
              </span>
            </Panel>
          </div>
        </PageBody>
      </main>
    </div>
  );
}
