import Link from "next/link";
import { getRedis } from "@/lib/redis";
import { createPoStore } from "@/lib/po-agent/store";
import { SessionActions } from "./actions";

export const dynamic = "force-dynamic";

export default async function SessionDetail({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const id = decodeURIComponent(sessionId);

  const redis = getRedis();
  if (!redis) return <Shell><p style={{ color: "#a33" }}>Redis not configured.</p></Shell>;
  const store = createPoStore(redis);
  const session = await store.loadSession(id);
  if (!session) return <Shell><p>Session not found: {id}</p></Shell>;

  return (
    <Shell>
      <p style={{ color: "#556" }}>
        {session.buyer?.companyName ?? "unknown company"} · {session.buyer?.email ?? "unknown"} · state:{" "}
        <strong>{session.state}</strong> · decision: {session.decision?.kind ?? "—"}
      </p>

      <section style={card}>
        <h3>Actions</h3>
        <SessionActions sessionId={id} />
      </section>

      {session.escalation && (
        <section style={card}>
          <h3>Escalation</h3>
          <p>Reasons: {session.escalation.reasons.join(", ")}</p>
          <p>Notified: {session.escalation.notified.join(", ")}</p>
        </section>
      )}

      <section style={card}>
        <h3>Extracted</h3>
        <pre style={pre}>{JSON.stringify(session.extracted, null, 2)}</pre>
      </section>

      <section style={card}>
        <h3>Lines</h3>
        <ul>
          {(session.resolution ?? []).map((r, i) => (
            <li key={i}>
              {r.matchedSku ?? r.line.sku ?? r.line.rawText} × {r.line.quantity ?? "?"} —{" "}
              {r.calculatedUnitPrice != null ? `$${r.calculatedUnitPrice.toFixed(2)}` : "unpriced"}{" "}
              {r.issues.length ? `[${r.issues.join(", ")}]` : ""}
            </li>
          ))}
        </ul>
      </section>

      {session.validation && session.validation.length > 0 && (
        <section style={card}>
          <h3>Issues</h3>
          <ul>
            {session.validation.map((v, i) => (
              <li key={i}><code>{v.kind}</code> — {v.message}</li>
            ))}
          </ul>
        </section>
      )}

      <section style={card}>
        <h3>Audit</h3>
        <ol style={{ fontSize: 13 }}>
          {session.audit.map((a, i) => (
            <li key={i}>
              <code>{a.at.slice(11, 19)}</code> <strong>{a.event}</strong>{" "}
              {a.detail ? <code>{JSON.stringify(a.detail)}</code> : null}
            </li>
          ))}
        </ol>
      </section>

      <p><Link href="/staff/po-inbox">← Back to inbox</Link></p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main style={{ padding: 32, maxWidth: 900, margin: "0 auto" }}>
      <h1>PO Session</h1>
      {children}
    </main>
  );
}

const card: React.CSSProperties = { border: "1px solid #e3e3e8", borderRadius: 8, padding: 16, marginBottom: 16 };
const pre: React.CSSProperties = { background: "#f7f7f9", padding: 12, borderRadius: 6, overflow: "auto", fontSize: 12 };
