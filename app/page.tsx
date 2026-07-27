import Link from "next/link";

export default function Home() {
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
          <h1>Offline PO Agent</h1>
          <p className="muted">
            Email-first purchase-order processing for BigCommerce B2B Edition. Buyers email a PO;
            the agent identifies the buyer, parses it, enforces B2B controls, and submits an order
            (pay-on-account) or a quote with a checkout link.
          </p>
        </div>
      </div>
      <div className="grid cols-2">
        <div className="card">
          <h3>Admin console</h3>
          <p className="muted">Dashboard, review queue, sessions, simulator, and settings.</p>
          <Link className="btn primary" href="/staff">Open admin</Link>
        </div>
        <div className="card">
          <h3>Public demo</h3>
          <p className="muted">Paste a PO and watch the pipeline run — no credentials needed.</p>
          <Link className="btn" href="/demo">Open demo</Link>
        </div>
      </div>
    </div>
    </>
  );
}
