import { PageBody, Panel } from "@/components/backbone";
import { Simulator } from "@/components/simulator";
import { PageHead } from "@/app/staff/ui";
import { LinkButton } from "@/components/ui/link-button";

export const dynamic = "force-dynamic";

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

export default function DemoPage() {
  return (
    <div style={frame}>
      <header style={header}>
        <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: "-0.01em" }}>PO Agent</span>
      </header>

      <main style={{ maxWidth: "var(--content-max)", margin: "0 auto", width: "100%", padding: "var(--page-pad)" }}>
        <PageBody>
          <PageHead
            title="PO Agent — live demo"
            sub={
              <>
                Buyers email a purchase order — PDF, spreadsheet, or plain text. This agent identifies the buyer,
                extracts the PO, enforces the same B2B controls the storefront would, and decides: place an order, send
                a quote, ask a clarifying question, or escalate. Paste a PO below and watch the pipeline run —{" "}
                <strong>nothing is submitted</strong>.
              </>
            }
          />

          <Simulator />

          <Panel>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
              <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                <span style={{ fontWeight: "var(--weight-semibold)" }}>Ready to connect your BigCommerce store?</span>
                <span style={{ fontSize: "var(--text-caption-size)", color: "var(--text-secondary)" }}>
                  This is a live demo running against a read-only simulation. The admin console lets you connect a real
                  store, configure rules, and monitor live PO traffic.
                </span>
              </span>
              <LinkButton href="/staff" variant="primary" iconAfter="arrow-right">Go to admin</LinkButton>
            </div>
          </Panel>
        </PageBody>
      </main>
    </div>
  );
}
