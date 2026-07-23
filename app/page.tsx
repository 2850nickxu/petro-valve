export default function Home() {
  return (
    <main style={{ padding: 32, maxWidth: 720 }}>
      <h1>Offline PO Agent</h1>
      <p>
        Email-first purchase-order processing for BigCommerce B2B Edition. B2B buyers
        email a purchase order (PDF, spreadsheet, or plain text); the agent identifies
        the buyer, parses the PO, enforces the same B2B controls the storefront would,
        and submits an <strong>order</strong> (pay-on-account) or a <strong>quote</strong>{" "}
        with a checkout link.
      </p>
      <ul>
        <li>
          <a href="/demo">Demo simulator</a> — paste a PO and watch the pipeline run
          (no email or credentials needed).
        </li>
        <li>
          <a href="/staff/po-inbox">Review queue</a> — escalated and recent sessions.
        </li>
      </ul>
      <p style={{ color: "#667", fontSize: 14 }}>
        Feature-flagged: set <code>PO_AGENT_ENABLED=true</code> to activate. Off by default.
      </p>
    </main>
  );
}
