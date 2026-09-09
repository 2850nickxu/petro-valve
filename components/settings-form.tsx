"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Badge,
  Box,
  Button,
  Counter,
  Flex,
  Grid,
  Input,
  Panel,
  Select,
  Small,
  Switch,
  Tabs,
  Text,
} from "@bigcommerce/big-design";
import { colors } from "@bigcommerce/big-design-theme";
import { useToast } from "@/components/ui/toast";
import { GmailConnect } from "@/components/gmail-connect";

export interface FieldDef {
  key: string;
  label: string;
  group: string;
  secret?: boolean;
  type?: "text" | "number" | "select" | "bool";
  options?: string[];
  placeholder?: string;
  help?: string;
}

type View = Record<string, { value: string; set: boolean; secret: boolean }>;

/** Effective values from the merged env, so a control shows the truth before it's overridden. */
export interface SettingsDefaults {
  enabled: boolean;
  firstOrderConfirm: boolean;
  forwardPriceMismatch: boolean;
  simulatorSend: boolean;
  simulatorSendEmails: boolean;
  priceTolerancePct: number;
  maxClarifications: number;
  channel: "google" | "microsoft";
}

/** Per-tab health dot, computed server-side. */
export interface SettingsHealth {
  agent: boolean;
  ai: boolean;
  channel: boolean;
  escalation: boolean;
  store: boolean;
}

type TabId = keyof SettingsHealth;

const TABS: Array<{ id: TabId; label: string; sub: string }> = [
  { id: "agent", label: "Agent", sub: "Decision tuning — how autonomous the agent is allowed to be." },
  { id: "ai", label: "AI model", sub: "Bring your own model, or run the free heuristic extractor." },
  { id: "channel", label: "Email channel", sub: "The mailbox buyers send purchase orders to." },
  { id: "escalation", label: "Escalation", sub: "Where a human gets pulled in when the agent stops." },
  { id: "store", label: "Store", sub: "The BigCommerce store the agent transacts against." },
];

// ── Controls ──────────────────────────────────────────────────────────────────
// Defined at module scope: a component declared inside the parent's render would be a new
// type on every keystroke, remounting the input and dropping focus mid-typing.

function SettingField({
  def,
  value,
  configured,
  onChange,
  wide,
}: {
  def?: FieldDef;
  value: string;
  configured?: boolean;
  onChange: (v: string) => void;
  wide?: boolean;
}) {
  if (!def) return null;
  const label: ReactNode = def.secret ? (
    <>
      {def.label}
      <span title="Encrypted at rest"> 🔒</span>
    </>
  ) : (
    def.label
  );

  if (def.type === "select") {
    return (
      <Box style={wide ? { gridColumn: "1 / -1" } : undefined}>
        <Select
          label={label}
          description={def.help}
          value={value}
          options={[
            { value: "", content: "(default)" },
            ...(def.options ?? []).map((o) => ({ value: o, content: o })),
          ]}
          onOptionChange={(v) => onChange(v ?? "")}
        />
      </Box>
    );
  }

  return (
    <Box style={wide ? { gridColumn: "1 / -1" } : undefined}>
      <Input
        label={label}
        description={def.help}
        type={def.secret ? "password" : def.type === "number" ? "number" : "text"}
        value={value}
        placeholder={def.secret && configured ? "•••• saved (enter to replace)" : (def.placeholder ?? "")}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
      />
    </Box>
  );
}

function SettingToggle({ def, on, onToggle }: { def?: FieldDef; on: boolean; onToggle: () => void }) {
  if (!def) return null;
  return (
    <Flex justifyContent="space-between" alignItems="center" paddingVertical="small" style={{ gap: 12 }}>
      <Box style={{ minWidth: 0 }}>
        <Text bold marginBottom="none">
          {def.label}
        </Text>
        {def.help ? (
          <Small color="secondary60" marginBottom="none">
            {def.help}
          </Small>
        ) : null}
      </Box>
      <Switch checked={on} onChange={onToggle} aria-label={def.label} style={{ flex: "none" }} />
    </Flex>
  );
}

function SettingSlider({
  def,
  value,
  min,
  max,
  suffix,
  note,
  onChange,
}: {
  def?: FieldDef;
  value: number;
  min: number;
  max: number;
  suffix?: string;
  note: ReactNode;
  onChange: (v: string) => void;
}) {
  if (!def) return null;
  // Some field labels already carry the unit (e.g. "Price tolerance %"); avoid doubling it up.
  const showSuffix = suffix && !def.label.trim().endsWith(suffix.trim());
  return (
    <Counter
      label={showSuffix ? `${def.label} (${suffix})` : def.label}
      description={note}
      value={value}
      step={1}
      onCountChange={(n) => onChange(String(Math.min(max, Math.max(min, n))))}
    />
  );
}

// ── Form ──────────────────────────────────────────────────────────────────────

export function SettingsForm({
  fields,
  view,
  defaults,
  health,
  origin,
  installs,
}: {
  fields: FieldDef[];
  view: View;
  defaults: SettingsDefaults;
  health: SettingsHealth;
  origin: string;
  installs: Array<{ storeHash: string; ownerEmail?: string; installedAt: string }>;
}) {
  const router = useRouter();
  const toast = useToast();

  const byKey = useMemo(() => {
    const m: Record<string, FieldDef> = {};
    for (const f of fields) m[f.key] = f;
    return m;
  }, [fields]);

  const initial = useMemo(() => {
    const v: Record<string, string> = {};
    for (const f of fields) v[f.key] = f.secret ? "" : (view[f.key]?.value ?? "");
    return v;
  }, [fields, view]);

  const [tab, setTab] = useState<TabId>("agent");
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<Partial<Record<TabId, { ok: boolean; detail: string }>>>({});

  const initialRef = useRef(initial);

  useEffect(() => {
    setDirty(Object.keys(initialRef.current).some((k) => values[k] !== initialRef.current[k]));
  }, [values]);

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  function set(key: string, val: string) {
    setValues((v) => ({ ...v, [key]: val }));
  }

  /** Booleans persist as "true"/"false"; "" means "inherit whatever the env says". */
  function boolOf(key: string, fallback: boolean): boolean {
    const v = values[key];
    if (v === "true") return true;
    if (v === "false") return false;
    return fallback;
  }
  function numOf(key: string, fallback: number): number {
    const v = values[key];
    if (v == null || v === "") return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  const selectedChannel = (values.PO_AGENT_CHANNEL || defaults.channel) as "google" | "microsoft";

  const field = (k: string, wide?: boolean) => (
    <SettingField
      def={byKey[k]}
      value={values[k] ?? ""}
      configured={view[k]?.set}
      onChange={(v) => set(k, v)}
      wide={wide}
    />
  );
  const toggle = (k: string, fallback: boolean) => {
    const on = boolOf(k, fallback);
    return <SettingToggle def={byKey[k]} on={on} onToggle={() => set(k, on ? "false" : "true")} />;
  };

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/staff/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const json = await res.json();
      if (res.ok) {
        toast.success(`Saved (${json.scope}).`);
        initialRef.current = { ...values };
        setDirty(false);
        router.refresh();
      } else {
        toast.error(`Save failed: ${json.error ?? res.status}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    const target =
      tab === "ai" ? "ai"
      : tab === "escalation" ? "slack"
      : tab === "store" ? "bigcommerce"
      : tab === "channel" ? (selectedChannel === "microsoft" ? "microsoft" : "gmail")
      : null;
    if (!target) return;

    setTesting(true);
    setTestMsg((m) => {
      const next = { ...m };
      delete next[tab];
      return next;
    });
    try {
      const res = await fetch("/api/staff/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target, values }),
      });
      const json = await res.json();
      setTestMsg((m) => ({
        ...m,
        [tab]: { ok: Boolean(json.ok), detail: json.detail ?? (res.ok ? "ok" : "failed") },
      }));
    } catch (e) {
      setTestMsg((m) => ({ ...m, [tab]: { ok: false, detail: e instanceof Error ? e.message : "failed" } }));
    } finally {
      setTesting(false);
    }
  }

  const active = TABS.find((t) => t.id === tab)!;
  const msg = testMsg[tab];
  const tolerance = numOf("PO_AGENT_PRICE_TOLERANCE_PCT", defaults.priceTolerancePct);

  const healthBadge = (
    <Box marginBottom="medium">
      <Badge label={health[tab] ? "configured" : "incomplete"} variant={health[tab] ? "success" : "warning"} />
    </Box>
  );

  const saveBar = (testLabel?: string) => (
    <Flex alignItems="center" flexWrap="wrap" marginTop="medium" style={{ gap: 12 }}>
      <Button variant="primary" onClick={save} isLoading={saving}>
        Save
      </Button>
      {tab !== "agent" && (
        <Button variant="secondary" onClick={test} isLoading={testing}>
          {testLabel ?? "Test connection"}
        </Button>
      )}
      {msg && (
        <Text color={msg.ok ? "success" : "danger"} bold marginBottom="none" style={{ fontSize: 12.5 }}>
          {msg.ok ? "✓ " : "✗ "}
          {msg.detail}
        </Text>
      )}
      {dirty && !saving && <Badge label="Unsaved changes" variant="warning" />}
    </Flex>
  );

  return (
    <>
      <Text color="secondary60" style={{ fontSize: 13, margin: "-14px 0 18px" }}>
        {active.sub}
      </Text>

      <Box marginBottom="medium">
        <Tabs
          activeTab={tab}
          onTabClick={(id) => setTab(id as TabId)}
          items={TABS.map((t) => ({ id: t.id, title: t.label }))}
        />
      </Box>

      {/* ── Agent ── */}
      {tab === "agent" && (
        <Panel>
          {healthBadge}
          {toggle("PO_AGENT_ENABLED", defaults.enabled)}
          {toggle("PO_AGENT_FIRST_ORDER_CONFIRM", defaults.firstOrderConfirm)}
          {toggle("PO_AGENT_SIMULATOR_SEND", defaults.simulatorSend)}
          {toggle("PO_AGENT_SIMULATOR_SEND_EMAILS", defaults.simulatorSendEmails)}

          <Grid gridColumns={{ mobile: "1fr", tablet: "1fr 1fr" }} gridGap="16px" marginTop="medium">
            <SettingSlider
              def={byKey.PO_AGENT_PRICE_TOLERANCE_PCT}
              value={tolerance}
              min={0}
              max={10}
              suffix="%"
              note={
                tolerance === 0
                  ? "Any price difference blocks the order."
                  : `Stated prices within ${tolerance}% of calculated pass silently.`
              }
              onChange={(v) => set("PO_AGENT_PRICE_TOLERANCE_PCT", v)}
            />
            <SettingSlider
              def={byKey.PO_AGENT_MAX_CLARIFICATIONS}
              value={numOf("PO_AGENT_MAX_CLARIFICATIONS", defaults.maxClarifications)}
              min={0}
              max={4}
              note="Question rounds before we escalate instead of asking again."
              onChange={(v) => set("PO_AGENT_MAX_CLARIFICATIONS", v)}
            />
          </Grid>

          <Grid gridColumns={{ mobile: "1fr", tablet: "1fr 1fr" }} gridGap="16px" marginTop="medium">
            {field("PO_AGENT_MODE")}
            {field("PO_AGENT_DAILY_SUBMIT_CAP")}
            {field("PO_AGENT_PO_PAYMENT_CODES", true)}
          </Grid>

          {saveBar()}
        </Panel>
      )}

      {/* ── AI model ── */}
      {tab === "ai" && (
        <Panel>
          {healthBadge}
          <Text color="secondary60" marginBottom="medium" style={{ fontSize: 13, lineHeight: 1.6 }}>
            Bring your own model as <code>provider:model-id</code>. Omit it entirely and the built-in heuristic
            extractor runs free of charge — an LLM is much better on messy PDFs.
          </Text>
          <Grid gridColumns={{ mobile: "1fr", tablet: "1fr 1fr" }} gridGap="16px">
            {field("PO_AGENT_MODEL")}
            {field("ANTHROPIC_API_KEY")}
            {field("OPENAI_API_KEY")}
            {field("GOOGLE_GENERATIVE_AI_API_KEY")}
          </Grid>
          {saveBar("Test & save")}
        </Panel>
      )}

      {/* ── Email channel ── */}
      {tab === "channel" && (
        <Panel>
          {healthBadge}
          <Flex marginBottom="medium" style={{ gap: 8 }}>
            {(["google", "microsoft"] as const).map((c) => (
              <Button
                key={c}
                variant={selectedChannel === c ? "primary" : "secondary"}
                onClick={() => set("PO_AGENT_CHANNEL", c)}
              >
                {c === "google" ? "Gmail" : "Microsoft Graph"}
              </Button>
            ))}
          </Flex>

          <Grid gridColumns={{ mobile: "1fr", tablet: "1fr 1fr" }} gridGap="16px">
            {field("PO_AGENT_MAILBOX")}
            {field("PO_AGENT_INBOUND_SECRET")}
          </Grid>

          {selectedChannel === "google" ? (
            <>
              <Grid gridColumns={{ mobile: "1fr", tablet: "1fr 1fr" }} gridGap="16px" marginTop="medium">
                {field("GOOGLE_PO_CLIENT_ID")}
                {field("GOOGLE_PO_CLIENT_SECRET")}
                {field("GOOGLE_PO_REFRESH_TOKEN")}
                {field("GOOGLE_PO_PUBSUB_TOPIC")}
              </Grid>
              <Box marginTop="medium">
                <Text bold marginBottom="small">
                  Connect the mailbox
                </Text>
                <GmailConnect origin={origin} />
              </Box>
            </>
          ) : (
            <Grid gridColumns={{ mobile: "1fr", tablet: "1fr 1fr" }} gridGap="16px" marginTop="medium">
              {field("MS_PO_TENANT_ID")}
              {field("MS_PO_CLIENT_ID")}
              {field("MS_PO_CLIENT_SECRET")}
              {field("MS_PO_MAILBOX")}
            </Grid>
          )}

          {saveBar("Test channel")}
        </Panel>
      )}

      {/* ── Escalation ── */}
      {tab === "escalation" && (
        <Panel>
          {healthBadge}
          <Grid gridColumns={{ mobile: "1fr", tablet: "1fr 1fr" }} gridGap="16px">
            {field("PO_AGENT_ESCALATION_EMAIL")}
            {field("PO_AGENT_SLACK_WEBHOOK_URL")}
          </Grid>
          <Text color="secondary60" marginTop="small" style={{ fontSize: 12 }}>
            Escalations always land in the Inbox; email and Slack are extra nudges.
          </Text>
          {toggle("PO_AGENT_FORWARD_PRICE_MISMATCH", defaults.forwardPriceMismatch)}
          {saveBar("Send test")}
        </Panel>
      )}

      {/* ── Store ── */}
      {tab === "store" && (
        <Panel>
          {healthBadge}
          <Text color="secondary60" marginBottom="medium" style={{ fontSize: 13, lineHeight: 1.6 }}>
            Installing the app supplies its own per-store OAuth token automatically. These fields are the manual
            single-store override.
          </Text>
          <Grid gridColumns={{ mobile: "1fr", tablet: "1fr 1fr" }} gridGap="16px">
            {field("BIGCOMMERCE_STORE_HASH")}
            {field("BIGCOMMERCE_ACCESS_TOKEN")}
            {field("BIGCOMMERCE_CHANNEL_ID")}
          </Grid>

          <Box marginTop="medium">
            <Text bold marginBottom="small">
              Installed stores
            </Text>
            {installs.length ? (
              <Box border="box" borderRadius="normal">
                {installs.map((i, idx) => (
                  <Flex
                    key={i.storeHash}
                    justifyContent="space-between"
                    alignItems="center"
                    flexWrap="wrap"
                    padding="small"
                    style={{ gap: 10, borderTop: idx > 0 ? `1px solid ${colors.secondary20}` : undefined }}
                  >
                    <Box style={{ flex: "1 1 200px", minWidth: 0 }}>
                      <Text bold marginBottom="none" style={{ fontFamily: "monospace", fontSize: 13 }}>
                        {i.storeHash}
                      </Text>
                      <Small color="secondary60" marginBottom="none">
                        {i.ownerEmail ?? "unknown owner"}
                      </Small>
                    </Box>
                    <Small color="secondary60" marginBottom="none" style={{ fontFamily: "monospace" }}>
                      {i.installedAt.slice(0, 16).replace("T", " ")}
                    </Small>
                    <Badge label="OAuth (per-store)" variant="secondary" />
                  </Flex>
                ))}
              </Box>
            ) : (
              <Text color="secondary60" marginBottom="none" style={{ fontSize: 12.5 }}>
                No app installs yet — the agent uses the deployment (env/global) settings.
              </Text>
            )}
          </Box>

          {saveBar("Test store")}
        </Panel>
      )}
    </>
  );
}
