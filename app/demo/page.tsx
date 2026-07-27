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
          <h1>PO Agent — Demo Simulator</h1>
          <p className="muted">
            Paste a purchase order and run the pipeline. Dry run — it never submits an order/quote
            and never sends email.
          </p>
        </div>
      </div>
      <Simulator />
    </div>
    </>
  );
}
