"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Badge,
  Button,
  Panel,
  SelectField,
  Switch,
  Tabs,
  TabPanel,
  TextField,
} from "@/components/backbone";
import { useToast } from "@/components/ui/toast";
import { GmailConnect } from "@/components/gmail-connect";
import { PreviewAccess } from "@/components/preview-access";

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

const GRID_TWO: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
  gap: "var(--gap-group)",
};

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
  // Secrets note that they are encrypted in their help text — Backbone's voice has no emoji.
  const help = def.secret ? [def.help, "Encrypted at rest."].filter(Boolean).join(" ") : def.help;

  if (def.type === "select") {
    return (
      <SelectField
        label={def.label}
        help={help}
        value={value}
        placeholder="(default)"
        options={(def.options ?? []).map((o) => ({ value: o, label: o }))}
        onChange={(e) => onChange(e.target.value)}
        style={wide ? { gridColumn: "1 / -1" } : undefined}
      />
    );
  }

  return (
    <TextField
      label={def.label}
      help={help}
      type={def.secret ? "password" : def.type === "number" ? "number" : "text"}
      value={value}
      placeholder={def.secret && configured ? "•••• saved (enter to replace)" : (def.placeholder ?? "")}
      onChange={(e) => onChange(e.target.value)}
      autoComplete="off"
      style={wide ? { gridColumn: "1 / -1" } : undefined}
    />
  );
}

function SettingToggle({ def, on, onToggle }: { def?: FieldDef; on: boolean; onToggle: () => void }) {
  if (!def) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingTop: "var(--space-1)", paddingBottom: "var(--space-1)" }}>
      <Switch checked={on} onChange={onToggle} label={def.label} />
      {def.help ? <span style={{ fontSize: "var(--text-caption-size)", color: "var(--text-metadata)" }}>{def.help}</span> : null}
    </div>
  );
}

function SettingNumber({
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
    <TextField
      label={showSuffix ? `${def.label} (${suffix})` : def.label}
      help={typeof note === "string" ? note : undefined}
      type="number"
      min={min}
      max={max}
      step={1}
      value={String(value)}
      onChange={(e) => {
        const n = Number(e.target.value);
        onChange(String(Math.min(max, Math.max(min, Number.isFinite(n) ? n : min))));
      }}
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
  showAi = true,
}: {
  fields: FieldDef[];
  view: View;
  defaults: SettingsDefaults;
  health: SettingsHealth;
  origin: string;
  installs: Array<{ storeHash: string; ownerEmail?: string; installedAt: string }>;
  /** False in the customer admin view: no AI model tab. */
  showAi?: boolean;
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

  const subOf = (id: TabId) => TABS.find((t) => t.id === id)?.sub;
  const msg = testMsg[tab];
  const tolerance = numOf("PO_AGENT_PRICE_TOLERANCE_PCT", defaults.priceTolerancePct);

  const healthBadge = (
    <Badge tone={health[tab] ? "success" : "warning"}>{health[tab] ? "configured" : "incomplete"}</Badge>
  );

  const saveBar = (testLabel?: string) => (
    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12, marginTop: "var(--gap-group)" }}>
      <Button variant="primary" onClick={save} loading={saving}>
        Save
      </Button>
      {tab !== "agent" && (
        <Button variant="secondary" onClick={test} loading={testing}>
          {testLabel ?? "Test connection"}
        </Button>
      )}
      {msg && (
        <span style={{ fontSize: "var(--text-caption-size)", fontWeight: 600, color: msg.ok ? "var(--success-600)" : "var(--danger-600)" }}>
          {msg.detail}
        </span>
      )}
      {dirty && !saving && <Badge tone="warning">Unsaved changes</Badge>}
    </div>
  );

  return (
    <>
      <Tabs
        label="Settings sections"
        idPrefix="settings"
        tabs={TABS.filter((t) => showAi || t.id !== "ai").map((t) => ({ value: t.id, label: t.label }))}
        value={tab}
        onChange={(v) => setTab(v as TabId)}
      />

      {/* ── Agent ── */}
      <TabPanel value="agent" activeValue={tab} idPrefix="settings">
        <Panel title="Agent" meta={subOf("agent")} actions={healthBadge} bodyStyle={{ gap: "var(--gap-group)" }}>
          <div>
            {toggle("PO_AGENT_ENABLED", defaults.enabled)}
            {toggle("PO_AGENT_FIRST_ORDER_CONFIRM", defaults.firstOrderConfirm)}
            {toggle("PO_AGENT_SIMULATOR_SEND", defaults.simulatorSend)}
            {toggle("PO_AGENT_SIMULATOR_SEND_EMAILS", defaults.simulatorSendEmails)}
          </div>

          <div style={GRID_TWO}>
            <SettingNumber
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
            <SettingNumber
              def={byKey.PO_AGENT_MAX_CLARIFICATIONS}
              value={numOf("PO_AGENT_MAX_CLARIFICATIONS", defaults.maxClarifications)}
              min={0}
              max={4}
              note="Question rounds before we escalate instead of asking again."
              onChange={(v) => set("PO_AGENT_MAX_CLARIFICATIONS", v)}
            />
          </div>

          <div style={GRID_TWO}>
            {field("PO_AGENT_MODE")}
            {field("PO_AGENT_DAILY_SUBMIT_CAP")}
            {field("PO_AGENT_PO_PAYMENT_CODES", true)}
          </div>

          {saveBar()}
        </Panel>
      </TabPanel>

      {/* ── AI model (Silk view only) ── */}
      {showAi ? (
        <TabPanel value="ai" activeValue={tab} idPrefix="settings">
          <Panel title="AI model" actions={healthBadge} bodyStyle={{ gap: "var(--gap-group)" }}>
            <span style={{ fontSize: "var(--text-caption-size)", color: "var(--text-secondary)", lineHeight: 1.6 }}>
              Bring your own model as <code>provider:model-id</code>. Omit it entirely and the built-in heuristic
              extractor runs free of charge — an LLM is much better on messy PDFs.
            </span>
            <div style={GRID_TWO}>
              {field("PO_AGENT_MODEL")}
              {field("ANTHROPIC_API_KEY")}
              {field("OPENAI_API_KEY")}
              {field("GOOGLE_GENERATIVE_AI_API_KEY")}
            </div>
            {saveBar("Test & save")}
          </Panel>
        </TabPanel>
      ) : null}

      {/* ── Email channel ── */}
      <TabPanel value="channel" activeValue={tab} idPrefix="settings">
        <Panel title="Email channel" actions={healthBadge} bodyStyle={{ gap: "var(--gap-group)" }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {(["google", "microsoft"] as const).map((c) => (
              <Button
                key={c}
                variant={selectedChannel === c ? "primary" : "secondary"}
                onClick={() => set("PO_AGENT_CHANNEL", c)}
              >
                {c === "google" ? "Gmail" : "Microsoft Graph"}
              </Button>
            ))}
          </div>

          <div style={GRID_TWO}>
            {field("PO_AGENT_MAILBOX")}
            {field("PO_AGENT_INBOUND_SECRET")}
          </div>

          {selectedChannel === "google" ? (
            <>
              <div style={GRID_TWO}>
                {field("GOOGLE_PO_CLIENT_ID")}
                {field("GOOGLE_PO_CLIENT_SECRET")}
                {field("GOOGLE_PO_REFRESH_TOKEN")}
                {field("GOOGLE_PO_PUBSUB_TOPIC")}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                <span style={{ fontWeight: "var(--weight-semibold)" }}>Connect the mailbox</span>
                <GmailConnect origin={origin} />
              </div>
            </>
          ) : (
            <div style={GRID_TWO}>
              {field("MS_PO_TENANT_ID")}
              {field("MS_PO_CLIENT_ID")}
              {field("MS_PO_CLIENT_SECRET")}
              {field("MS_PO_MAILBOX")}
            </div>
          )}

          {saveBar("Test channel")}
        </Panel>
      </TabPanel>

      {/* ── Escalation ── */}
      <TabPanel value="escalation" activeValue={tab} idPrefix="settings">
        <Panel title="Escalation" meta={subOf("escalation")} actions={healthBadge} bodyStyle={{ gap: "var(--gap-group)" }}>
          <div style={GRID_TWO}>
            {field("PO_AGENT_ESCALATION_EMAIL")}
            {field("PO_AGENT_SLACK_WEBHOOK_URL")}
          </div>
          <span style={{ fontSize: "var(--text-caption-size)", color: "var(--text-metadata)" }}>
            Escalations always land in the Inbox; email and Slack are extra nudges.
          </span>
          {toggle("PO_AGENT_FORWARD_PRICE_MISMATCH", defaults.forwardPriceMismatch)}
          {saveBar("Send test")}
        </Panel>
      </TabPanel>

      {/* ── Store ── */}
      <TabPanel
        value="store"
        activeValue={tab}
        idPrefix="settings"
        style={{ display: "flex", flexDirection: "column", gap: "var(--gap-section)" }}
      >
        <Panel title="Store" actions={healthBadge} bodyStyle={{ gap: "var(--gap-group)" }}>
          <span style={{ fontSize: "var(--text-caption-size)", color: "var(--text-secondary)", lineHeight: 1.6 }}>
            Installing the app supplies its own per-store OAuth token automatically. These fields are the manual
            single-store override.
          </span>
          <div style={GRID_TWO}>
            {field("BIGCOMMERCE_STORE_HASH")}
            {field("BIGCOMMERCE_ACCESS_TOKEN")}
            {field("BIGCOMMERCE_CHANNEL_ID")}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            <span style={{ fontWeight: "var(--weight-semibold)" }}>Installed stores</span>
            {installs.length ? (
              <div style={{ border: "var(--border-w) solid var(--border-default)", borderRadius: "var(--radius-md)" }}>
                {installs.map((i, idx) => (
                  <div
                    key={i.storeHash}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      flexWrap: "wrap",
                      gap: 10,
                      padding: "var(--space-2-5) var(--space-3)",
                      borderTop: idx > 0 ? "var(--border-w) solid var(--border-subtle)" : undefined,
                    }}
                  >
                    <span style={{ flex: "1 1 200px", minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text-primary)" }}>{i.storeHash}</span>
                      <span style={{ fontSize: "var(--text-caption-size)", color: "var(--text-metadata)" }}>{i.ownerEmail ?? "unknown owner"}</span>
                    </span>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-caption-size)", color: "var(--text-metadata)" }}>
                      {i.installedAt.slice(0, 16).replace("T", " ")}
                    </span>
                    <Badge tone="neutral">OAuth (per-store)</Badge>
                  </div>
                ))}
              </div>
            ) : (
              <span style={{ fontSize: "var(--text-caption-size)", color: "var(--text-metadata)" }}>
                No app installs yet — the agent uses the deployment (env/global) settings.
              </span>
            )}
          </div>

          {saveBar("Test store")}
        </Panel>
        <PreviewAccess />
      </TabPanel>
    </>
  );
}
