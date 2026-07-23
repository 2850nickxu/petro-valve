#!/usr/bin/env node
// Smoke test: inject fixture POs through the dry-run pipeline via the running app's
// /api/po-agent/simulate endpoint (bypasses Gmail). Start the app first (npm run dev),
// then: node scripts/po-agent-smoke.mjs [baseUrl]
//
// With BigCommerce store creds set, this exercises identify → pricing → decide against
// the sandbox. Without them, it shows heuristic extraction only.

const BASE = process.argv[2] ?? process.env.SMOKE_BASE_URL ?? "http://localhost:3000";

const FIXTURES = [
  {
    name: "clean terms order",
    from: process.env.SMOKE_BUYER ?? "buyer@acme.com",
    subject: "Purchase order",
    bodyText: "PO Number: PO-5567\nPlease pay on account, net 30.\nSKU: WIDGET-100 Qty: 10 $9.84\nSKU: BOLT-250 Qty: 40",
  },
  {
    name: "credit-card → quote",
    from: process.env.SMOKE_BUYER ?? "buyer@acme.com",
    subject: "Card order",
    bodyText: "We'll pay by credit card.\nSKU: WIDGET-100 Qty: 5",
  },
  {
    name: "unknown sender",
    from: "stranger@nowhere.example",
    subject: "PO",
    bodyText: "SKU: WIDGET-100 Qty: 1",
  },
  {
    name: "non-PO (triage)",
    from: process.env.SMOKE_BUYER ?? "buyer@acme.com",
    subject: "Question",
    bodyText: "Hi, can you tell me the status of my last order?",
  },
];

async function run() {
  for (const f of FIXTURES) {
    try {
      const res = await fetch(`${BASE}/api/po-agent/simulate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: f.from, subject: f.subject, bodyText: f.bodyText }),
      });
      const json = await res.json();
      const decision = json.session?.decision?.kind ?? (json.storeConfigured === false ? "(extraction only)" : "?");
      const state = json.session?.state ?? "-";
      console.log(`\n▶ ${f.name}`);
      console.log(`   decision: ${decision} | state: ${state}`);
      if (json.session?.validation?.length) {
        console.log(`   issues: ${json.session.validation.map((v) => v.kind).join(", ")}`);
      }
    } catch (e) {
      console.error(`\n✗ ${f.name}: ${e.message}`);
    }
  }
  console.log("");
}

run();
