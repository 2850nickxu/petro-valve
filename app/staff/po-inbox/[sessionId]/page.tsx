import Link from "next/link";
import type { CSSProperties } from "react";
import { Panel } from "@/components/backbone";
import { getRedis } from "@/lib/redis";
import { createPoStore } from "@/lib/po-agent/store";
import { activeStoreSource } from "@/lib/bc-app/request-context";
import { sessionStoreHash } from "@/lib/bc-app/request-context";
import { effectiveEnv } from "@/lib/po-agent/effective-env";
import { adminStatus } from "@/lib/po-agent/admin-status";
import { adminLinks } from "@/lib/bc/admin-links";
import { summarizeOutcome } from "@/lib/po-agent/summary";
import { estimatedSubtotal } from "@/lib/po-agent/core/price";
import { submittableLines } from "@/lib/po-agent/core/resolve";
import { replyTemplates } from "@/lib/po-agent/reply-templates";
import { Chip, PageHead, stateLabel } from "../../ui";
import { Banner } from "@/components/ui/states";
import { Disclosure } from "@/components/ui/section";
import { formatMoney } from "@/components/ui/money";
import { ReplyBox } from "@/components/reply-box";
import { AiCard, Callout, KeyValue, type CalloutTone, type KeyValueRow } from "@/components/ui/detail-widgets";
import { SessionThread } from "@/components/session-thread";
import { DecisionTrail } from "@/components/decision-trail";
import { conversationThread, decisionTrail } from "@/lib/po-agent/session-view";
import { SessionActionButtons, SessionNote, type ActionSummary } from "./actions";
import type { DecisionKind, PoSession, ResolvedLine } from "@/lib/po-agent/types";

export const dynamic = "force-dynamic";

const CALLOUT_TONE: Record<DecisionKind | "pending", CalloutTone> = {
  order: "ok",
  quote: "ok",
  escalate: "bad",
  clarify: "warn",
  reject: "bad",
  pending: "info",
};

/** Row tint + issue colour follow the worst issue on the line. */
function lineSeverity(l: ResolvedLine): { tint?: "bad" | "warn"; color: string } {
  const bad = ["line_unresolved", "line_parent_sku", "line_blocked_by_assortment", "price_mismatch"];
  const warn = ["line_inventory_short", "line_qty_bounds", "missing_quantity"];
  if (l.issues.some((i) => bad.includes(i))) return { tint: "bad", color: "var(--danger-600)" };
  if (l.issues.some((i) => warn.includes(i))) return { tint: "warn", color: "var(--warning-600)" };
  return { color: "var(--success-600)" };
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
      if (kind === "line_parent_sku") {
        const n = l.variantChoiceCount ?? l.variantChoices?.length ?? 0;
        return n ? `parent SKU (${n} versions)` : "parent SKU";
      }
      return kind;
    })
    .join(", ");
}

function poOf(session: PoSession): string | undefined {
  return session.extracted?.poNumber ?? undefined;
}

function addressLine(a: NonNullable<PoSession["extracted"]>["shipTo"]): string | null {
  if (!a) return null;
  const parts = [a.line1, a.city, [a.state, a.zip].filter(Boolean).join(" ")].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

const num: CSSProperties = { fontVariantNumeric: "tabular-nums" };

// Dark, quiet block for the raw email body and JSON — reads from the inverse surface tokens.
const RAW_BLOCK: CSSProperties = {
  margin: 0,
  padding: "var(--panel-pad)",
  background: "var(--surface-inverse)",
  borderRadius: "var(--radius-md)",
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  lineHeight: 1.5,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  color: "var(--text-inverse)",
  overflow: "auto",
};

const backLink: CSSProperties = { fontSize: "var(--text-caption-size)", fontWeight: 600, color: "var(--text-link)", textDecoration: "none" };

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
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--gap-group)" }}>
        <Link href="/staff/po-inbox" style={backLink}>← Inbox</Link>
        <Panel>
          Not found: <code>{id}</code>.
        </Panel>
      </div>
    );
  }

  const hash = await sessionStoreHash();
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

  const resultRows: KeyValueRow[] = [];
  if (session.result?.orderId != null) {
    const orderId = session.result.orderId;
    resultRows.push({
      key: "order",
      label: "Order",
      value: (
        <span style={num}>
          #{orderId}
          {links && (
            <>
              {" · "}
              <a href={links.order(orderId)} target="_blank" rel="noreferrer">view in BigCommerce</a>
            </>
          )}
        </span>
      ),
    });
  }
  if (session.result?.quoteId != null) {
    resultRows.push({
      key: "quote",
      label: "Quote",
      value: <span style={num}>{session.result.quoteNumber ?? session.result.quoteId}</span>,
    });
  }
  if (session.result?.checkoutUrl) {
    resultRows.push({
      key: "checkout",
      label: "Checkout link",
      value: <a href={session.result.checkoutUrl} target="_blank" rel="noreferrer">open</a>,
    });
  }
  if (session.result?.quoteUrl) {
    resultRows.push({
      key: "portal",
      label: "Buyer portal",
      value: <a href={session.result.quoteUrl} target="_blank" rel="noreferrer">open</a>,
    });
  }

  const aiRows: KeyValueRow[] = [];
  if (extracted) {
    aiRows.push({ key: "poNumber", label: "poNumber", value: <span style={num}>{extracted.poNumber ?? "—"}</span> });
    aiRows.push({ key: "paymentIntent", label: "paymentIntent", value: <span style={num}>{extracted.paymentIntent}</span> });
    aiRows.push({ key: "confidence", label: "confidence", value: <span style={num}>{extracted.confidence}</span> });
    if (extracted.requestedShipDate) {
      aiRows.push({ key: "requestedShipDate", label: "requestedShipDate", value: <span style={num}>{extracted.requestedShipDate}</span> });
    }
    if (extracted.currency) {
      aiRows.push({ key: "currency", label: "currency", value: <span style={num}>{extracted.currency}</span> });
    }
    const addr = addressLine(extracted.shipTo);
    if (addr) aiRows.push({ key: "shipTo", label: "shipTo", value: addr });
    if (extracted.buyerNote) aiRows.push({ key: "buyerNote", label: "buyerNote", value: `“${extracted.buyerNote}”` });
  }

  const thread = conversationThread(session);
  const trail = decisionTrail(session);
  const stepCount = session.audit.length;

  const metaLine = (
    <span style={{ display: "inline-flex", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
      <span>
        {session.buyer?.email ?? session.inbound?.from ?? "unknown sender"} · <span style={num}>{session.id}</span>
        {poOf(session) ? <> · <span style={num}>{poOf(session)}</span></> : null}
      </span>
      <Chip kind={session.state}>{stateLabel(session.state)}</Chip>
    </span>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--gap-section)", maxWidth: 1240 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        <Link href="/staff/po-inbox" style={backLink}>← Inbox</Link>
        <PageHead title={session.buyer?.companyName || "(unknown sender)"} sub={metaLine}>
          <SessionActionButtons sessionId={id} summary={actionSummary} />
        </PageHead>
      </div>

      <Callout
        tone={CALLOUT_TONE[outcome.kind]}
        title={
          <>
            {outcome.headline}
            {outcome.kind === "escalate" && session.escalation?.reasons.length
              ? ` — ${session.escalation.reasons.join(", ")}`
              : ""}
          </>
        }
      >
        {outcome.reasons.length ? outcome.reasons.join(" ") : "No blocking issues."}
        {notified.length ? ` Notified: ${notified.join(", ")}.` : ""}
        {session.clarificationRounds > 0
          ? ` ${session.clarificationRounds} clarification round${session.clarificationRounds === 1 ? "" : "s"} used.`
          : ""}
      </Callout>

      <ReplyBox
        sessionId={id}
        mailbox={status.mailbox}
        templates={replyTemplates(session)}
        canSend={canReply}
        disabledReason={replyDisabledReason}
      />

      {session.result && (session.result.orderId || session.result.quoteId) && (
        <Panel title="Result">
          <KeyValue rows={resultRows} />
        </Panel>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 440px), 1fr))", gap: "var(--gap-group)", alignItems: "start" }}>
        <Panel title="Conversation" meta="Every email on this thread, oldest first. Times in UTC.">
          <SessionThread entries={thread} footer={<SessionNote sessionId={id} />} />
        </Panel>
        <Panel
          title="Decision trail"
          meta={<span style={num}>What the agent did, what it looked at, and why · {stepCount} step{stepCount === 1 ? "" : "s"}</span>}
        >
          <DecisionTrail runs={trail} links={links} currency={currency ?? undefined} />
        </Panel>
      </div>

      <Panel
        title="Lines"
        padded={false}
        meta={<span style={num}>{submittable.length} of {lines.length} submittable · est. {actionSummary.estimatedTotal}</span>}
      >
        {lines.length ? (
          lines.map((l, i) => {
            const sev = lineSeverity(l);
            const unit = l.calculatedUnitPrice ?? l.line.statedUnitPrice;
            const bg = sev.tint === "bad" ? "var(--danger-tint)" : sev.tint === "warn" ? "var(--warning-tint)" : undefined;
            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: "8px 14px",
                  padding: "var(--space-3) var(--panel-pad)",
                  background: bg,
                  borderTop: i > 0 ? "var(--border-w) solid var(--border-subtle)" : undefined,
                }}
              >
                <span style={{ flex: "1 1 230px", minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, ...num }}>{l.matchedSku ?? l.line.sku ?? "— no match —"}</span>
                  <span style={{ fontSize: "var(--text-caption-size)", color: "var(--text-muted)", ...num }}>read from: “{l.line.rawText.trim()}”</span>
                  {l.productName ? <span style={{ fontSize: "var(--text-caption-size)", color: "var(--text-muted)" }}>{l.productName}</span> : null}
                  {l.parentSku && l.variantChoices?.length ? (
                    <span style={{ fontSize: "var(--text-caption-size)", color: "var(--text-muted)", ...num }}>
                      choose one: {l.variantChoices.slice(0, 4).map((c) => c.sku).join(", ")}
                      {(l.variantChoiceCount ?? l.variantChoices.length) > 4 ? ` +${(l.variantChoiceCount ?? l.variantChoices.length) - 4} more` : ""}
                    </span>
                  ) : null}
                </span>
                <span style={{ fontSize: 12.5, color: "var(--text-metadata)", flex: "none", ...num }}>
                  {l.line.quantity ?? "?"} × {unit != null ? formatMoney(unit, currency) : "?"}
                </span>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: sev.color, flex: "none", ...num }}>{issueLabel(l)}</span>
              </div>
            );
          })
        ) : (
          <div style={{ padding: "var(--panel-pad)", color: "var(--text-secondary)" }}>No resolved lines.</div>
        )}
      </Panel>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "var(--gap-group)", alignItems: "start" }}>
        <AiCard title="Extracted from the email">
          {extracted ? <KeyValue variant="lines" rows={aiRows} /> : <span style={{ color: "var(--text-secondary)" }}>Nothing extracted for this session.</span>}
        </AiCard>

        <Panel title="Buyer">
          {session.buyer ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5 }}>
              <span>
                B2B user <span style={num}>#{session.buyer.b2bUserId}</span>
                {session.buyer.companyRoleName ? ` · ${session.buyer.companyRoleName}` : ""}
              </span>
              <span>
                Customer <span style={num}>#{session.buyer.customerId}</span>
                {session.buyer.customerGroupId != null ? <> · group <span style={num}>#{session.buyer.customerGroupId}</span></> : null}
                {links && (
                  <> · <a href={links.customer(session.buyer.customerId)} target="_blank" rel="noreferrer">view</a></>
                )}
              </span>
              <span>
                {session.buyer.channelList?.length ? (
                  <>Channels <span style={num}>{session.buyer.channelList.join(", ")}</span></>
                ) : (
                  <>Channel <span style={num}>{session.channelId ?? "default"}</span></>
                )}
              </span>
            </div>
          ) : (
            <span style={{ color: "var(--text-secondary)" }}>No B2B user matched this sender.</span>
          )}
        </Panel>
      </div>

      <Disclosure title="Raw extraction (JSON)">
        <pre style={RAW_BLOCK}>{JSON.stringify(session.extracted, null, 2)}</pre>
      </Disclosure>
    </div>
  );
}
