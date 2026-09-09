"use client";

import { useState } from "react";
import styled from "styled-components";
import { Badge, Box, Button, Flex, Grid, Input, Panel, Text, Textarea } from "@bigcommerce/big-design";
import { colors, theme, type Colors } from "@bigcommerce/big-design-theme";
import { useToast } from "@/components/ui/toast";
import { Banner, EmptyState } from "@/components/ui/states";
import { badgeVariant } from "@/lib/ui/badge-variant";
import { summarizeOutcome } from "@/lib/po-agent/summary";
import { formatMoney } from "@/components/ui/money";
import type { DecisionKind, ValidationIssueKind } from "@/lib/po-agent/types";

// ── Scenario library ──────────────────────────────────────────────────────────

interface Scenario {
  label: string;
  from: string;
  subject: string;
  body: string;
}

const SCENARIOS: Scenario[] = [
  {
    label: "Clean terms order",
    from: "buyer@acme.com",
    subject: "New purchase order",
    body: `PO Number: PO-5567
Please pay on account, net 30.

SKU: WIDGET-100   Qty: 10   $9.84
SKU: BOLT-250     Qty: 40`,
  },
  {
    label: "Credit card → quote",
    from: "buyer@acme.com",
    subject: "Purchase order — card payment",
    body: `PO Number: PO-5568
Please charge our credit card on file.

SKU: WIDGET-100   Qty: 10   $9.84
SKU: BOLT-250     Qty: 40`,
  },
  {
    label: "Unknown sender → reject",
    from: "stranger@example.com",
    subject: "Purchase order",
    body: `PO Number: PO-9001
Please pay on account, net 30.

SKU: WIDGET-100   Qty: 5   $9.84`,
  },
  {
    label: "Broken SKU → clarify",
    from: "buyer@acme.com",
    subject: "Purchase order with new items",
    body: `PO Number: PO-5569
Please pay on account, net 30.

SKU: DOES-NOT-EXIST-999   Qty: 5   $19.99`,
  },
];

const CUSTOM_LABEL = "Custom";

// ── Types ─────────────────────────────────────────────────────────────────────

type SimResult = {
  storeConfigured: boolean;
  modelConfigured?: boolean;
  note?: string;
  extracted?: unknown;
  sandbox?: boolean;
  sandboxBlocked?: boolean;
  emailsSent?: boolean;
  captured?: Array<{ to?: string; subject?: string; text?: string }>;
  session?: {
    state: string;
    decision?: { kind: DecisionKind; reasons: string[] };
    escalation?: { reasons: string[] };
    buyer?: { companyName?: string; email?: string };
    extracted?: { currency?: string | null };
    validation?: Array<{ kind: ValidationIssueKind; message: string; lineRef?: string; blocking: boolean }>;
    resolution?: Array<{
      matchedSku?: string;
      productId?: number;
      calculatedUnitPrice?: number;
      parentSku?: boolean;
      variantChoices?: Array<{ variantId: number; sku: string; optionLabel?: string; unitPrice?: number }>;
      variantChoiceCount?: number;
      issues: string[];
      line: { rawText: string; quantity: number | null };
    }>;
    result?: { orderId?: number; quoteId?: number; quoteNumber?: string; checkoutUrl?: string; quoteUrl?: string };
    audit?: Array<{ at: string; event: string; detail?: unknown }>;
  };
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Left-rule colour for the decision panel, keyed off the shared Badge-variant map
 * (the same `order`/`quote`/`clarify`/`escalate`/`reject` → variant mapping used across
 * the staff surface, so the decision colour is consistent everywhere it appears). */
const RULE_COLOR: Record<string, keyof Colors> = {
  primary: "primary40",
  secondary: "secondary40",
  success: "success40",
  warning: "warning40",
  danger: "danger40",
};

/** Audit-event dot colour. */
const STEP_COLOR: Record<string, keyof Colors> = {
  received: "success40",
  identified: "success40",
  extracted: "success40",
  resolved: "success40",
  triaged: "success40",
  decided: "primary40",
  reopened: "success40",
  error: "danger40",
  escalated: "danger40",
};

function stepColor(event: string, detail?: unknown): keyof Colors {
  if (STEP_COLOR[event]) return STEP_COLOR[event];
  return typeof detail === "string" && detail.includes("error") ? "danger40" : "success40";
}

/** Compact, readable rendering of an audit detail blob. */
function stepDetail(detail: unknown): string {
  if (detail == null) return "";
  if (typeof detail === "string") return detail;
  if (typeof detail === "object") {
    return Object.entries(detail as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
      .join(" · ");
  }
  return String(detail);
}

const SKELETON_WIDTHS = ["62%", "100%", "84%", "73%", "91%"];

// Bespoke themed code block — Big Design has no pre-formatted output primitive, so this
// reads its colours straight from the shared theme (never `props.theme`).
const CodeBlock = styled.pre`
  margin: 0;
  padding: 13px;
  border-radius: ${theme.borderRadius.normal};
  background: ${theme.colors.secondary70};
  color: ${theme.colors.white};
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  overflow: auto;
`;

// ── Component ─────────────────────────────────────────────────────────────────

export function Simulator({
  defaultFrom = "buyer@acme.com",
  sandbox = false,
  sandboxEmails = false,
}: {
  defaultFrom?: string;
  sandbox?: boolean;
  sandboxEmails?: boolean;
}) {
  const toast = useToast();

  const initialScenario = defaultFrom === SCENARIOS[0].from ? SCENARIOS[0].label : CUSTOM_LABEL;
  const [scenario, setScenario] = useState<string>(initialScenario);
  const [from, setFrom] = useState(defaultFrom);
  const [subject, setSubject] = useState(SCENARIOS[0].subject);
  const [bodyText, setBodyText] = useState(SCENARIOS[0].body);

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SimResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleScenarioChange(label: string) {
    setScenario(label);
    if (label === CUSTOM_LABEL) return; // leave the form as-is
    const s = SCENARIOS.find((sc) => sc.label === label);
    if (!s) return;
    setFrom(s.from);
    setSubject(s.subject);
    setBodyText(s.body);
  }

  function handleFormEdit() {
    setScenario(CUSTOM_LABEL);
  }

  async function run() {
    setLoading(true);
    setError(null);
    // Keep the previous result and inputs on error so nothing is lost.
    try {
      const res = await fetch("/api/po-agent/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, subject, bodyText }),
      });
      const json = await res.json();
      if (!res.ok) {
        const msg = json.error ?? "Request failed";
        setError(msg);
        toast.error(msg);
      } else {
        setResult(json);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Request failed";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  function copyText(text: string) {
    navigator.clipboard.writeText(text).then(
      () => toast.success("Copied."),
      () => toast.error("Copy failed — please select and copy manually."),
    );
  }

  const s = result?.session;
  const outcome = s ? summarizeOutcome(s) : null;
  const decisionKind = s?.decision?.kind ?? "";
  const decisionVariant = decisionKind ? badgeVariant(decisionKind) : "primary";
  const ruleColor = RULE_COLOR[decisionVariant] ?? "primary40";
  const currency = s?.extracted?.currency;

  return (
    <Grid gridColumns={{ mobile: "1fr", tablet: "1.2fr 1fr" }} gridGap="14px" style={{ alignItems: "start" }}>
      {/* ── Left: the PO ── */}
      <Panel marginBottom="none">
        {sandbox && (
          <Box marginBottom="medium">
            <Banner kind="warn" title="Sandbox — real submissions ON">
              {sandboxEmails
                ? "Orders/quotes go to the connected store and buyer emails will send."
                : "Orders/quotes go to the connected store; buyer emails are suppressed and captured below."}
            </Banner>
          </Box>
        )}

        <Box marginBottom="medium">
          <Text bold marginBottom="xSmall" style={{ fontSize: 12.5 }}>
            Scenario
          </Text>
          <Flex flexWrap="wrap" alignItems="center" style={{ gap: 8 }}>
            {SCENARIOS.map((sc) => (
              <Button
                key={sc.label}
                variant={scenario === sc.label ? "primary" : "secondary"}
                onClick={() => handleScenarioChange(sc.label)}
              >
                {sc.label}
              </Button>
            ))}
            {scenario === CUSTOM_LABEL && <Badge label="Custom" variant="secondary" />}
          </Flex>
        </Box>

        <Box marginBottom="medium">
          <Input
            label="Sender email"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              handleFormEdit();
            }}
          />
        </Box>

        <Box marginBottom="medium">
          <Input
            label="Subject"
            value={subject}
            onChange={(e) => {
              setSubject(e.target.value);
              handleFormEdit();
            }}
          />
        </Box>

        <Box marginBottom="medium">
          <Textarea
            label="PO body"
            value={bodyText}
            onChange={(e) => {
              setBodyText(e.target.value);
              handleFormEdit();
            }}
            rows={7}
            style={{ fontSize: 13 }}
          />
        </Box>

        <Flex alignItems="center" flexWrap="wrap" style={{ gap: 12 }}>
          <Button variant="primary" onClick={run} isLoading={loading}>
            {loading ? "Running…" : "Run pipeline"}
          </Button>
          <Text color="secondary60" marginBottom="none" style={{ fontSize: 11.5 }}>
            Try &ldquo;pay by credit card&rdquo; for a quote, or an unknown sender for a reject.
          </Text>
        </Flex>

        {error && (
          <Text color="danger" marginTop="small" marginBottom="none">
            {error}
          </Text>
        )}

        <Text color="secondary60" marginTop="small" marginBottom="none" style={{ fontSize: 12 }}>
          {sandbox
            ? "Sandbox mode — submits a REAL order/quote to the connected store (tagged “[PO agent sandbox]”)."
            : "Dry run — never submits an order/quote and never sends email."}
        </Text>
      </Panel>

      {/* ── Right: the decision ── */}
      <Box>
        {!result && !loading && (
          <Panel marginBottom="none">
            <EmptyState title="Run a PO to see the decision">
              identify → extract → resolve → price → validate → decide
            </EmptyState>
          </Panel>
        )}

        {loading && (
          <Panel marginBottom="none">
            <Flex flexDirection="column" style={{ gap: 10 }}>
              {SKELETON_WIDTHS.map((w) => (
                <Box
                  key={w}
                  backgroundColor="secondary20"
                  borderRadius="normal"
                  style={{ width: w, height: 10 }}
                />
              ))}
            </Flex>
          </Panel>
        )}

        {!loading && result && !result.storeConfigured && (
          <Panel marginBottom="none" header="Store not configured">
            <Text color="secondary60" marginBottom="medium">
              {result.note}
            </Text>
            <Banner kind="info">
              Connect a BigCommerce store in <a href="/staff/settings">Settings</a> to run the full pipeline.
            </Banner>
            {result.extracted ? (
              <Box marginTop="medium">
                <CodeBlock>{JSON.stringify(result.extracted, null, 2)}</CodeBlock>
              </Box>
            ) : null}
          </Panel>
        )}

        {!loading && s && (
          <Flex flexDirection="column" style={{ gap: 14 }}>
            {result?.sandboxBlocked && (
              <Banner kind="warn" title="Ran as a dry run">
                Sandbox mode is on but Redis or a store token is missing. No order/quote was placed.
              </Banner>
            )}

            <Panel
              marginBottom="none"
              style={{ borderLeftWidth: 4, borderLeftStyle: "solid", borderLeftColor: colors[ruleColor] }}
            >
              <Flex flexWrap="wrap" alignItems="center" style={{ gap: 10 }}>
                <Badge label={decisionKind || "—"} variant={decisionVariant} />
                <Text color="secondary60" marginBottom="none" style={{ fontSize: 12.5 }}>
                  {s.decision?.reasons.join(" · ") || outcome?.headline}
                </Text>
              </Flex>
              <Text color="secondary60" marginTop="small" marginBottom="none" style={{ fontSize: 12 }}>
                {s.buyer?.companyName ?? "unidentified sender"}
                {s.buyer?.email ? ` · ${s.buyer.email}` : ""}
              </Text>
              {outcome && outcome.reasons.length > 0 && (
                <Box as="ul" marginTop="small" style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12.5 }}>
                  {outcome.reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </Box>
              )}
            </Panel>

            {result?.sandbox && s.result && (s.result.orderId || s.result.quoteId) && (
              <Panel
                marginBottom="none"
                header="Submitted"
                badge={{ label: result.emailsSent ? "emails sent" : "emails captured", variant: "secondary" }}
              >
                {s.result.orderId && (
                  <Text marginBottom="small">
                    Order <span style={{ fontFamily: "monospace", fontWeight: 600 }}>#{s.result.orderId}</span> placed
                    in the store.
                  </Text>
                )}
                {s.result.quoteId && (
                  <Text marginBottom="small">
                    Quote{" "}
                    <span style={{ fontFamily: "monospace", fontWeight: 600 }}>
                      {s.result.quoteNumber ?? s.result.quoteId}
                    </span>{" "}
                    created.
                    {s.result.checkoutUrl && (
                      <>
                        {" "}
                        <a href={s.result.checkoutUrl} target="_blank" rel="noreferrer">
                          Checkout link →
                        </a>{" "}
                        <Button variant="subtle" onClick={() => copyText(s.result!.checkoutUrl!)}>
                          Copy
                        </Button>
                      </>
                    )}
                  </Text>
                )}
                <Text color="secondary60" marginBottom="none" style={{ fontSize: 12 }}>
                  Tagged &ldquo;[PO agent sandbox]&rdquo; — safe to delete in the store.
                </Text>
              </Panel>
            )}

            {result?.sandbox && !result.emailsSent && result.captured && result.captured.length > 0 && (
              <Panel
                marginBottom="none"
                header="Captured emails"
                badge={{ label: String(result.captured.length), variant: "secondary" }}
              >
                <Flex flexDirection="column" style={{ gap: 12 }}>
                  {result.captured.map((c, i) => (
                    <Box key={i}>
                      <Flex
                        justifyContent="space-between"
                        alignItems="center"
                        flexWrap="wrap"
                        marginBottom="xxSmall"
                        style={{ gap: 8 }}
                      >
                        <Text color="secondary60" marginBottom="none" style={{ fontSize: 12 }}>
                          {c.to ? `to ${c.to} · ` : ""}
                          {c.subject}
                        </Text>
                        <Button variant="subtle" onClick={() => copyText(c.text ?? "")}>
                          Copy
                        </Button>
                      </Flex>
                      <CodeBlock>{c.text}</CodeBlock>
                    </Box>
                  ))}
                </Flex>
              </Panel>
            )}

            {s.resolution && s.resolution.length > 0 && (
              <Panel marginBottom="none" header="Lines">
                <Flex flexDirection="column">
                  {s.resolution.map((r, i) => {
                    const bad = r.issues.some(
                      (x) => x === "line_unresolved" || x === "line_parent_sku" || x === "price_mismatch",
                    );
                    const warn = !bad && r.issues.length > 0;
                    const tone: keyof Colors = bad ? "danger" : warn ? "warning" : "success";
                    const rowBg: keyof Colors | undefined = bad ? "danger10" : warn ? "warning10" : undefined;
                    return (
                      <Flex
                        key={i}
                        justifyContent="space-between"
                        alignItems="flex-start"
                        flexWrap="wrap"
                        backgroundColor={rowBg}
                        padding="small"
                        style={{ gap: 10, borderTop: i > 0 ? `1px solid ${colors.secondary20}` : undefined }}
                      >
                        <Box style={{ flex: "1 1 230px", minWidth: 0 }}>
                          <Text marginBottom="none" style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 600 }}>
                            {r.matchedSku ?? "— no match —"}
                          </Text>
                          <Text
                            color="secondary60"
                            marginTop="xxSmall"
                            marginBottom="none"
                            style={{ fontFamily: "monospace", fontSize: 12 }}
                          >
                            read from: “{r.line.rawText.trim()}”
                          </Text>
                          {r.parentSku && r.variantChoices?.length ? (
                            <Text
                              color="secondary60"
                              marginTop="xxSmall"
                              marginBottom="none"
                              style={{ fontFamily: "monospace", fontSize: 12 }}
                            >
                              parent SKU — choose one:{" "}
                              {r.variantChoices
                                .slice(0, 4)
                                .map((c) =>
                                  c.unitPrice != null ? `${c.sku} @ ${formatMoney(c.unitPrice, currency)}` : c.sku,
                                )
                                .join(", ")}
                              {(r.variantChoiceCount ?? r.variantChoices.length) > 4
                                ? ` +${(r.variantChoiceCount ?? r.variantChoices.length) - 4} more`
                                : ""}
                            </Text>
                          ) : null}
                        </Box>
                        <Text
                          marginBottom="none"
                          style={{ fontFamily: "monospace", fontSize: 12.5, color: colors.secondary60, flex: "none" }}
                        >
                          {r.line.quantity ?? "?"} ×{" "}
                          {r.calculatedUnitPrice != null ? formatMoney(r.calculatedUnitPrice, currency) : "?"}
                        </Text>
                        <Text
                          bold
                          marginBottom="none"
                          style={{ fontFamily: "monospace", fontSize: 11.5, color: colors[tone], flex: "none" }}
                        >
                          {r.issues.join(", ") || "ok"}
                        </Text>
                      </Flex>
                    );
                  })}
                </Flex>
              </Panel>
            )}

            {s.validation && s.validation.length > 0 && (
              <Panel marginBottom="none" header="Issues">
                <Box as="ul" style={{ margin: 0, paddingLeft: 18, fontSize: 12.5 }}>
                  {s.validation.map((v, i) => (
                    <li key={i}>
                      <code>{v.kind}</code>
                      {v.lineRef ? ` (${v.lineRef})` : ""} — {v.message}
                    </li>
                  ))}
                </Box>
              </Panel>
            )}

            {s.audit && s.audit.length > 0 && (
              <Panel marginBottom="none" header="Pipeline">
                <Flex flexDirection="column" style={{ gap: 8 }}>
                  {s.audit.map((a, i) => (
                    <Flex key={i} alignItems="flex-start" style={{ gap: 8 }}>
                      <Box
                        backgroundColor={stepColor(a.event, a.detail)}
                        borderRadius="circle"
                        style={{ width: 7, height: 7, marginTop: 5, flex: "none" }}
                      />
                      <Text marginBottom="none" style={{ fontSize: 12 }}>
                        <strong>{a.event}</strong> <span>{stepDetail(a.detail)}</span>
                      </Text>
                    </Flex>
                  ))}
                </Flex>
              </Panel>
            )}
          </Flex>
        )}
      </Box>
    </Grid>
  );
}
