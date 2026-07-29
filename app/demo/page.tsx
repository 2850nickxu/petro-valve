import { Simulator } from "@/components/simulator";

export const dynamic = "force-dynamic";

export default function DemoPage() {
  return (
    <>
      <div className="public-bar" />
      <div className="public-brand">
        <img src="/silk-logo-color.svg" alt="Silk Commerce" />
        <span className="app-divider" />
        <span className="app-title">PO Agent</span>
      </div>
      <div className="container">
        <div className="page-head">
          <div>
            <h1>PO Agent — Live Demo</h1>
            <p className="muted">
              Buyers email a purchase order — PDF, spreadsheet, or plain text. This agent
              identifies the buyer, extracts the PO, enforces the same B2B controls the
              storefront would, and decides: place an order, send a quote, ask a clarifying
              question, or escalate. Paste a PO below and watch the pipeline run —{" "}
              <strong>nothing is submitted</strong>.
            </p>
          </div>
        </div>

        <Simulator />

        <div className="card" style={{ marginTop: 32 }}>
          <div className="row-between" style={{ alignItems: "center", flexWrap: "wrap", gap: 12 }}>
            <div>
              <strong>Ready to connect your BigCommerce store?</strong>
              <p className="muted" style={{ margin: "4px 0 0" }}>
                This is a live demo running against a read-only simulation. The admin console
                lets you connect a real store, configure rules, and monitor live PO traffic.
              </p>
            </div>
            <a href="/staff" className="btn primary" style={{ whiteSpace: "nowrap" }}>
              Go to Admin →
            </a>
          </div>
        </div>
      </div>
    </>
  );
}
