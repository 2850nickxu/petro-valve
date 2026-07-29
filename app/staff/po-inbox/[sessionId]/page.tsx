import Link from "next/link";
import { cookies } from "next/headers";
import { getRedis } from "@/lib/redis";
import { createPoStore } from "@/lib/po-agent/store";
import { activeStoreSource } from "@/lib/bc-app/request-context";
import { verifiedStoreHash } from "@/lib/bc-app/resolve-context";
import { effectiveEnv } from "@/lib/po-agent/effective-env";
import { adminStatus } from "@/lib/po-agent/admin-status";
import { adminLinks } from "@/lib/bc/admin-links";
import { summarizeOutcome } from "@/lib/po-agent/summary";
import { estimatedSubtotal } from "@/lib/po-agent/core/price";
import { submittableLines } from "@/lib/po-agent/core/resolve";
import { replyTemplates } from "@/lib/po-agent/reply-templates";
import { Chip, CardHead, stateLabel } from "../../ui";
import { Banner } from "@/components/ui/states";
import { Disclosure } from "@/components/ui/section";
import { formatMoney } from "@/components/ui/money";
import { ReplyBox } from "@/components/reply-box";
import { SessionActionButtons, SessionNote, type ActionSummary } from "./actions";
import type { DecisionKind, PoSession, ResolvedLine } from "@/lib/po-agent/types";

export const dynamic = "force-dynamic";

const CALLOUT_TONE: Record<DecisionKind | "pending", "ok" | "warn" | "bad" | "info"> = {
  order: "ok",
  quote: "ok",
  escalate: "bad",
  clarify: "warn",
  reject: "bad",
  pending: "info",
};

/** Row tint + issue colour follow the worst issue on the line. */
function lineSeverity(l: ResolvedLine): { tint?: "bad" | "warn"; tone: string } {
  const bad = ["line_unresolved", "line_blocked_by_assortment", "price_mismatch"];
  const warn = ["line_inventory_short", "line_qty_bounds", "missing_quantity"];
  if (l.issues.some((i) => bad.includes(i))) return { tint: "bad", tone: "var(--bad-fg)" };
  if (l.issues.some((i) => warn.includes(i))) return { tint: "warn", tone: "var(--warn-fg)" };
  return { tone: "var(--ok-fg)" };
}

/** Compact issue label for the line row — "price_mismatch 5.3%" style. */
function issueLabel(l: ResolvedLine): string {
  if (!l.issues.length) return "ok";
  return l.issues
    .map((kind) => {
      if (kind === "price_mismatch") {
        const stated = l.line.statedUnitPrice;
        const calc = l.calculatedUnitPrice;
        if (stated != null && calc != null && calc > 0) {
          const pct = (Math.abs(stated - calc) / calc) * 100;
          return `price_mismatch ${pct.toFixed(1)}%`;
        }
        return kind;
      }
      if (kind === "line_inventory_short" && l.inventoryLevel != null) {
        return `inventory short (${l.inventoryLevel} on hand)`;
      }
      return kind;
    })
    .join(", ");
}

const AUDIT_TONE: Record<string, string> = {
  received: "sage",
  identified: "sage",
  extracted: "sage",
  resolved: "warn",
  decided: "sky",
  clarified: "warn",
  reminded: "warn",
  triaged: "sage",
  replied: "sky",
  note: "sky",
  reopened: "sage",
  escalated: "bad",
  error: "bad",
  expired: "sage",
  dismissed: "bad",
  forced_order: "ok",
  forced_quote: "ok",
  forwarded_below_contract: "warn",
};

function auditTone(event: string): string {
  return AUDIT_TONE[event] ?? "sage";
}

function poOf(session: PoSession): string | undefined {
  return session.extracted?.poNumber ?? undefined;
}

function addressLine(a: NonNullable<PoSession["extracted"]>["shipTo"]): string | null {
  if (!a) return null;
  const parts = [a.line1, a.city, [a.state, a.zip].filter(Boolean).join(" ")].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

export default async function SessionDetail({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const id = decodeURIComponent(sessionId);

  const redis = getRedis();
  if (!redis) {
    return (
      <Banner kind="error" title="Redis not configured">
        The review queue and session store are unavailable.
      </Banner>
    );
  }
  const store = createPoStore(redis);
  const session = await store.loadSession(id);
  if (!session) {
    return (
      <>
        <Link href="/staff/po-inbox" style={{ fontSize: 12.5, fontWeight: 600 }}>← Inbox</Link>
        <div className="card mt-3">
          <div className="card-body">
            Not found: <code>{id}</code>.
          </div>
        </div>
      </>
    );
  }

  const hash = verifiedStoreHash((await cookies()).get("poa_app")?.value);
  const status = adminStatus(await effectiveEnv(hash ?? undefined));
  const links = adminLinks((await activeStoreSource()).storeHash);
  const currency = session.extracted?.currency;
  const outcome = summarizeOutcome(session);
  const lines = session.resolution ?? [];
  const extracted = session.extracted;
  const submittable = submittableLines(lines);
  const unresolvedCount = lines.length - submittable.length;

  const actionSummary: ActionSummary = {
    poNumber: poOf(session),
    submittable: submittable.length,
    unresolved: unresolvedCount,
    estimatedTotal: formatMoney(estimatedSubtotal(lines), currency),
  };

  const hasChannel = status.channelCreds.google || status.channelCreds.microsoft;
  const canReply = hasChannel && Boolean(session.buyer?.email ?? session.inbound?.from);
  const replyDisabledReason = !hasChannel
    ? "Connect an email channel in Settings to reply on the buyer's thread."
    : "This session has no known buyer address to reply to.";

  const notified = session.escalation?.notified ?? [];

  return (
    <div className="narrow-900">
      <Link href="/staff/po-inbox" style={{ fontSize: 12.5, fontWeight: 600 }}>← Inbox</Link>

      <div className="pa-pagehead mt-2">
        <div>
          <h1 style={{ fontSize: 22 }}>{session.buyer?.companyName || "(unknown sender)"}</h1>
          <div className="pa-wrap mt-1">
            <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
              {session.buyer?.email ?? session.inbound?.from ?? "unknown sender"} ·{" "}
              <span className="num">{session.id}</span>
              {poOf(session) ? <> · <span className="num">{poOf(session)}</span></> : null}
            </span>
            <Chip kind={session.state} size="sm">{stateLabel(session.state)}</Chip>
          </div>
        </div>
        <div className="pa-wrap spacer">
          <SessionActionButtons sessionId={id} summary={actionSummary} />
        </div>
      </div>

      <div className={`pa-callout ${CALLOUT_TONE[outcome.kind]} mb-4`}>
        <div className="t">
          {outcome.headline}
          {outcome.kind === "escalate" && session.escalation?.reasons.length
            ? ` — ${session.escalation.reasons.join(", ")}`
            : ""}
        </div>
        <div className="b">
          {outcome.reasons.length ? outcome.reasons.join(" ") : "No blocking issues."}
          {notified.length ? ` Notified: ${notified.join(", ")}.` : ""}
          {session.clarificationRounds > 0
            ? ` ${session.clarificationRounds} clarification round${session.clarificationRounds === 1 ? "" : "s"} used.`
            : ""}
        </div>
      </div>

      <ReplyBox
        sessionId={id}
        mailbox={status.mailbox}
        templates={replyTemplates(session)}
        canSend={canReply}
        disabledReason={replyDisabledReason}
      />

      {session.result && (session.result.orderId || session.result.quoteId) && (
        <div className="card mb-3">
          <CardHead title="Result" />
          <div className="card-body">
            <div className="kv">
              {session.result.orderId != null && (
                <>
                  <span className="k">Order</span>
                  <span className="num">
                    #{session.result.orderId}
                    {links && (
                      <> · <a href={links.order(session.result.orderId)} target="_blank" rel="noreferrer">view in BigCommerce ↗</a></>
                    )}
                  </span>
                </>
              )}
              {session.result.quoteId != null && (
                <>
                  <span className="k">Quote</span>
                  <span className="num">{session.result.quoteNumber ?? session.result.quoteId}</span>
                </>
              )}
              {session.result.checkoutUrl && (
                <>
                  <span className="k">Checkout link</span>
                  <span><a href={session.result.checkoutUrl} target="_blank" rel="noreferrer">open ↗</a></span>
                </>
              )}
              {session.result.quoteUrl && (
                <>
                  <span className="k">Buyer portal</span>
                  <span><a href={session.result.quoteUrl} target="_blank" rel="noreferrer">open ↗</a></span>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="card mb-3">
        <CardHead title="Lines">
          <span className="faint" style={{ fontSize: 11.5, fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
            <span className="num">{submittable.length}</span> of <span className="num">{lines.length}</span> submittable ·
            est. <span className="num">{actionSummary.estimatedTotal}</span>
          </span>
        </CardHead>
        {lines.length ? (
          lines.map((l, i) => {
            const sev = lineSeverity(l);
            const unit = l.calculatedUnitPrice ?? l.line.statedUnitPrice;
            return (
              <div key={i} className={`pa-row${sev.tint ? ` tint-${sev.tint}` : ""}`}>
                <div className="pa-grow">
                  <div className="num" style={{ fontSize: 13, fontWeight: 600, color: "var(--head)" }}>
                    {l.matchedSku ?? l.line.sku ?? "— no match —"}
                  </div>
                  <div className="r-sub num">read from: “{l.line.rawText.trim()}”</div>
                  {l.productName ? <div className="r-sub">{l.productName}</div> : null}
                </div>
                <span className="num" style={{ fontSize: 12.5, color: "var(--body2)", flex: "none" }}>
                  {l.line.quantity ?? "?"} × {unit != null ? formatMoney(unit, currency) : "?"}
                </span>
                <span className="num" style={{ fontSize: 11.5, fontWeight: 700, color: sev.tone, flex: "none" }}>
                  {issueLabel(l)}
                </span>
              </div>
            );
          })
        ) : (
          <div className="card-body"><span className="muted">No resolved lines.</span></div>
        )}
      </div>

      <div className="pa-2col mb-3">
        <div className="card ai">
          <div className="card-head sm">
            <span className="ai-tag">AI</span>
            <span>Extracted from the email</span>
          </div>
          <div className="card-body sm">
            {extracted ? (
              <div className="kv-lines">
                <div><span className="k">poNumber</span> · <span className="num">{extracted.poNumber ?? "—"}</span></div>
                <div><span className="k">paymentIntent</span> · <span className="num">{extracted.paymentIntent}</span></div>
                <div><span className="k">confidence</span> · <span className="num">{extracted.confidence}</span></div>
                {extracted.requestedShipDate ? (
                  <div><span className="k">requestedShipDate</span> · <span className="num">{extracted.requestedShipDate}</span></div>
                ) : null}
                {extracted.currency ? (
                  <div><span className="k">currency</span> · <span className="num">{extracted.currency}</span></div>
                ) : null}
                {addressLine(extracted.shipTo) ? (
                  <div><span className="k">shipTo</span> · {addressLine(extracted.shipTo)}</div>
                ) : null}
                {extracted.buyerNote ? (
                  <div><span className="k">buyerNote</span> · “{extracted.buyerNote}”</div>
                ) : null}
              </div>
            ) : (
              <span className="muted">Nothing extracted for this session.</span>
            )}
          </div>
        </div>

        <div className="pa-col">
          <div className="card">
            <CardHead title="Buyer" sm />
            <div className="card-body sm lines-1">
              {session.buyer ? (
                <>
                  <div>
                    B2B user <span className="num">#{session.buyer.b2bUserId}</span>
                    {session.buyer.companyRoleName ? ` · ${session.buyer.companyRoleName}` : ""}
                  </div>
                  <div>
                    Customer <span className="num">#{session.buyer.customerId}</span>
                    {session.buyer.customerGroupId != null ? <> · group <span className="num">#{session.buyer.customerGroupId}</span></> : null}
                    {links && (
                      <> · <a href={links.customer(session.buyer.customerId)} target="_blank" rel="noreferrer">view ↗</a></>
                    )}
                  </div>
                  <div>
                    {session.buyer.channelList?.length
                      ? <>Channels <span className="num">{session.buyer.channelList.join(", ")}</span></>
                      : <>Channel <span className="num">{session.channelId ?? "default"}</span></>}
                  </div>
                </>
              ) : (
                <span className="muted">No B2B user matched this sender.</span>
              )}
            </div>
          </div>

          <div className="card">
            <CardHead title="Audit trail" sm />
            <div className="card-body sm">
              <div className="timeline">
                {[...session.audit].reverse().map((a, i) => (
                  <div className="ev" key={i}>
                    <span className={`dot-status ${auditTone(a.event)}`} />
                    <div className="txt">
                      <strong>{a.event}</strong>{" "}
                      {a.actor ? <span className="tag">{a.actor}</span> : null}{" "}
                      <span>
                        {a.note
                          ? a.note.length > 90 ? `${a.note.slice(0, 90)}…` : a.note
                          : a.detail != null
                            ? JSON.stringify(a.detail)
                            : ""}
                      </span>
                    </div>
                    <div className="at">{a.at.slice(11, 16)}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="card">
            <CardHead title="Internal note" sm />
            <SessionNote sessionId={id} />
          </div>
        </div>
      </div>

      <div className="card mb-3">
        <CardHead title="Original email" />
        <div className="card-body">
          {session.inbound ? (
            <>
              <div className="kv mb-2">
                <span className="k">From</span><span className="num">{session.inbound.from}</span>
                <span className="k">Subject</span><span>{session.inbound.subject || "—"}</span>
              </div>
              <pre className="block">{session.inbound.bodyText || "(empty body)"}</pre>
            </>
          ) : (
            <span className="muted">
              Original email not stored for this session (it predates capture, or was a simulator run).
            </span>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-body">
          <Disclosure title="Raw extraction (JSON)">
            <pre className="block">{JSON.stringify(session.extracted, null, 2)}</pre>
          </Disclosure>
        </div>
      </div>
    </div>
  );
}
