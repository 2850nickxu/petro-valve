import Link from "next/link";
import { cookies } from "next/headers";
import { Box, Flex, Grid, H2, Link as BdLink, Panel, Small, Text } from "@bigcommerce/big-design";
import { colors, type Colors } from "@bigcommerce/big-design-theme";
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
import {
  AiCard,
  Callout,
  KeyValue,
  Timeline,
  type CalloutTone,
  type KeyValueRow,
  type StatusTone,
  type TimelineItem,
} from "@/components/ui/detail-widgets";
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
function lineSeverity(l: ResolvedLine): { tint?: "bad" | "warn"; tone: keyof Colors } {
  const bad = ["line_unresolved", "line_parent_sku", "line_blocked_by_assortment", "price_mismatch"];
  const warn = ["line_inventory_short", "line_qty_bounds", "missing_quantity"];
  if (l.issues.some((i) => bad.includes(i))) return { tint: "bad", tone: "danger" };
  if (l.issues.some((i) => warn.includes(i))) return { tint: "warn", tone: "warning" };
  return { tone: "success" };
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

const AUDIT_TONE: Record<string, StatusTone> = {
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

function auditTone(event: string): StatusTone {
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

const num = { fontVariantNumeric: "tabular-nums" as const };

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
        <Link href="/staff/po-inbox" style={{ fontSize: 12.5, fontWeight: 600, color: colors.primary }}>
          ← Inbox
        </Link>
        <Box marginTop="medium" border="box" borderRadius="normal" backgroundColor="white" padding="medium">
          Not found: <code>{id}</code>.
        </Box>
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
              <BdLink href={links.order(orderId)} external target="_blank" rel="noreferrer">
                view in BigCommerce
              </BdLink>
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
      value: (
        <BdLink href={session.result.checkoutUrl} external target="_blank" rel="noreferrer">
          open
        </BdLink>
      ),
    });
  }
  if (session.result?.quoteUrl) {
    resultRows.push({
      key: "portal",
      label: "Buyer portal",
      value: (
        <BdLink href={session.result.quoteUrl} external target="_blank" rel="noreferrer">
          open
        </BdLink>
      ),
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

  const auditItems: TimelineItem[] = [...session.audit].reverse().map((a, i) => ({
    key: i,
    tone: auditTone(a.event),
    title: a.event,
    tag: a.actor,
    detail: a.note ? (a.note.length > 90 ? `${a.note.slice(0, 90)}…` : a.note) : a.detail != null ? JSON.stringify(a.detail) : undefined,
    time: a.at.slice(11, 16),
  }));

  return (
    <Box style={{ maxWidth: 900 }}>
      <Link href="/staff/po-inbox" style={{ fontSize: 12.5, fontWeight: 600, color: colors.primary }}>
        ← Inbox
      </Link>

      <Flex
        justifyContent="space-between"
        alignItems="flex-end"
        flexWrap="wrap"
        marginTop="small"
        marginBottom="medium"
        style={{ gap: "12px 16px" }}
      >
        <Box>
          <H2 marginBottom="none">{session.buyer?.companyName || "(unknown sender)"}</H2>
          <Flex alignItems="center" flexWrap="wrap" marginTop="xxSmall" style={{ gap: 10 }}>
            <Small color="secondary60" marginBottom="none">
              {session.buyer?.email ?? session.inbound?.from ?? "unknown sender"} · <span style={num}>{session.id}</span>
              {poOf(session) ? (
                <>
                  {" · "}
                  <span style={num}>{poOf(session)}</span>
                </>
              ) : null}
            </Small>
            <Chip kind={session.state} size="sm">
              {stateLabel(session.state)}
            </Chip>
          </Flex>
        </Box>
        <SessionActionButtons sessionId={id} summary={actionSummary} />
      </Flex>

      <Box marginBottom="medium">
        <Callout tone={CALLOUT_TONE[outcome.kind]} title={
          <>
            {outcome.headline}
            {outcome.kind === "escalate" && session.escalation?.reasons.length
              ? ` — ${session.escalation.reasons.join(", ")}`
              : ""}
          </>
        }>
          {outcome.reasons.length ? outcome.reasons.join(" ") : "No blocking issues."}
          {notified.length ? ` Notified: ${notified.join(", ")}.` : ""}
          {session.clarificationRounds > 0
            ? ` ${session.clarificationRounds} clarification round${session.clarificationRounds === 1 ? "" : "s"} used.`
            : ""}
        </Callout>
      </Box>

      <Box marginBottom="medium">
        <ReplyBox
          sessionId={id}
          mailbox={status.mailbox}
          templates={replyTemplates(session)}
          canSend={canReply}
          disabledReason={replyDisabledReason}
        />
      </Box>

      {session.result && (session.result.orderId || session.result.quoteId) && (
        <Panel header="Result" marginBottom="medium">
          <KeyValue rows={resultRows} />
        </Panel>
      )}

      <Box border="box" borderRadius="normal" backgroundColor="white" marginBottom="medium">
        <Box
          padding="medium"
          style={lines.length ? { borderBottom: `1px solid ${colors.secondary20}` } : undefined}
        >
          <CardHead title="Lines">
            <Small color="secondary60" marginBottom="none" style={num}>
              {submittable.length} of {lines.length} submittable · est. {actionSummary.estimatedTotal}
            </Small>
          </CardHead>
        </Box>
        {lines.length ? (
          lines.map((l, i) => {
            const sev = lineSeverity(l);
            const unit = l.calculatedUnitPrice ?? l.line.statedUnitPrice;
            const bg = sev.tint === "bad" ? "danger10" : sev.tint === "warn" ? "warning10" : undefined;
            return (
              <Flex
                key={i}
                justifyContent="space-between"
                alignItems="center"
                flexWrap="wrap"
                backgroundColor={bg}
                padding="medium"
                style={{
                  gap: "8px 14px",
                  borderBottom: i < lines.length - 1 ? `1px solid ${colors.secondary20}` : undefined,
                }}
              >
                <Box style={{ flex: "1 1 230px", minWidth: 0 }}>
                  <Text bold marginBottom="none" style={{ fontSize: 13, ...num }}>
                    {l.matchedSku ?? l.line.sku ?? "— no match —"}
                  </Text>
                  <Small color="secondary50" marginBottom="none" style={num}>
                    read from: “{l.line.rawText.trim()}”
                  </Small>
                  {l.productName ? (
                    <Small color="secondary50" marginBottom="none">
                      {l.productName}
                    </Small>
                  ) : null}
                  {l.parentSku && l.variantChoices?.length ? (
                    <Small color="secondary50" marginBottom="none" style={num}>
                      choose one: {l.variantChoices.slice(0, 4).map((c) => c.sku).join(", ")}
                      {(l.variantChoiceCount ?? l.variantChoices.length) > 4
                        ? ` +${(l.variantChoiceCount ?? l.variantChoices.length) - 4} more`
                        : ""}
                    </Small>
                  ) : null}
                </Box>
                <Small color="secondary60" marginBottom="none" style={{ fontSize: 12.5, flex: "none", ...num }}>
                  {l.line.quantity ?? "?"} × {unit != null ? formatMoney(unit, currency) : "?"}
                </Small>
                <Text bold color={sev.tone} marginBottom="none" style={{ fontSize: 11.5, flex: "none", ...num }}>
                  {issueLabel(l)}
                </Text>
              </Flex>
            );
          })
        ) : (
          <Box padding="medium">
            <Text color="secondary60" marginBottom="none">
              No resolved lines.
            </Text>
          </Box>
        )}
      </Box>

      <Grid gridColumns={{ mobile: "1fr", desktop: "1.2fr 1fr" }} gridGap="14px" marginBottom="medium">
        <AiCard title="Extracted from the email">
          {extracted ? (
            <KeyValue variant="lines" rows={aiRows} />
          ) : (
            <Text color="secondary60" marginBottom="none">
              Nothing extracted for this session.
            </Text>
          )}
        </AiCard>

        <Flex flexDirection="column" style={{ gap: 14 }}>
          <Panel header="Buyer" marginBottom="none">
            {session.buyer ? (
              <Flex flexDirection="column" style={{ gap: 6 }}>
                <Text marginBottom="none" style={{ fontSize: 12.5 }}>
                  B2B user <span style={num}>#{session.buyer.b2bUserId}</span>
                  {session.buyer.companyRoleName ? ` · ${session.buyer.companyRoleName}` : ""}
                </Text>
                <Text marginBottom="none" style={{ fontSize: 12.5 }}>
                  Customer <span style={num}>#{session.buyer.customerId}</span>
                  {session.buyer.customerGroupId != null ? (
                    <>
                      {" · group "}
                      <span style={num}>#{session.buyer.customerGroupId}</span>
                    </>
                  ) : null}
                  {links && (
                    <>
                      {" · "}
                      <BdLink href={links.customer(session.buyer.customerId)} external target="_blank" rel="noreferrer">
                        view
                      </BdLink>
                    </>
                  )}
                </Text>
                <Text marginBottom="none" style={{ fontSize: 12.5 }}>
                  {session.buyer.channelList?.length ? (
                    <>
                      Channels <span style={num}>{session.buyer.channelList.join(", ")}</span>
                    </>
                  ) : (
                    <>
                      Channel <span style={num}>{session.channelId ?? "default"}</span>
                    </>
                  )}
                </Text>
              </Flex>
            ) : (
              <Text color="secondary60" marginBottom="none">
                No B2B user matched this sender.
              </Text>
            )}
          </Panel>

          <Panel header="Audit trail" marginBottom="none">
            <Timeline items={auditItems} />
          </Panel>

          <Panel header="Internal note" marginBottom="none">
            <SessionNote sessionId={id} />
          </Panel>
        </Flex>
      </Grid>

      <Panel header="Original email" marginBottom="medium">
        {session.inbound ? (
          <>
            <KeyValue
              rows={[
                { key: "from", label: "From", value: <span style={num}>{session.inbound.from}</span> },
                { key: "subject", label: "Subject", value: session.inbound.subject || "—" },
              ]}
            />
            <Box
              marginTop="small"
              backgroundColor="secondary70"
              borderRadius="normal"
              padding="medium"
              style={{ overflow: "auto" }}
            >
              <pre
                style={{
                  margin: 0,
                  fontFamily: "inherit",
                  fontSize: 12,
                  lineHeight: 1.5,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  color: colors.secondary10,
                }}
              >
                {session.inbound.bodyText || "(empty body)"}
              </pre>
            </Box>
          </>
        ) : (
          <Text color="secondary60" marginBottom="none">
            Original email not stored for this session (it predates capture, or was a simulator run).
          </Text>
        )}
      </Panel>

      <Box border="box" borderRadius="normal" backgroundColor="white" padding="medium">
        <Disclosure title="Raw extraction (JSON)">
          <Box
            marginTop="small"
            backgroundColor="secondary70"
            borderRadius="normal"
            padding="medium"
            style={{ overflow: "auto" }}
          >
            <pre
              style={{
                margin: 0,
                fontFamily: "inherit",
                fontSize: 12,
                lineHeight: 1.5,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                color: colors.secondary10,
              }}
            >
              {JSON.stringify(session.extracted, null, 2)}
            </pre>
          </Box>
        </Disclosure>
      </Box>
    </Box>
  );
}
