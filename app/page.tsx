import Link from "next/link";
import { ThemeToggle } from "@/components/ui/theme-toggle";

export default function Home() {
  return (
    <>
      <div className="public-bar" />
      <div className="public-brand">
        <img className="app-logo light" src="/silk-logo-color.svg" alt="Silk Commerce" />
        <img className="app-logo dark" src="/silk-logo-white.svg" alt="" aria-hidden="true" />
        <span className="app-divider" />
        <span className="app-title">PO Agent</span>
        <span className="spacer" />
        <ThemeToggle />
      </div>

      <div className="container">
        <div className="pa-pagehead">
          <div>
            <h1>Offline PO Agent</h1>
            <p className="sub">
              Email-first purchase-order processing for BigCommerce B2B Edition. Buyers email a PO; the agent
              identifies the buyer, parses it, enforces B2B controls, and submits an order (pay-on-account) or a quote
              with a checkout link.
            </p>
          </div>
        </div>

        <div className="pa-2col">
          <div className="card pad">
            <h3 className="mb-2">Admin console</h3>
            <p className="muted mt-0">Dashboard, review queue, sessions, simulator, and settings.</p>
            <Link className="btn primary mt-2" href="/staff">Open admin</Link>
          </div>
          <div className="card pad">
            <h3 className="mb-2">Public demo</h3>
            <p className="muted mt-0">Paste a PO and watch the pipeline run — no credentials needed.</p>
            <Link className="btn mt-2" href="/demo">Open demo</Link>
          </div>
        </div>
      </div>
    </>
  );
}
