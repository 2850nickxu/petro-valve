"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
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
  const id = `f-${def.key}`;
  return (
    <div className="field" style={wide ? { gridColumn: "1 / -1" } : undefined}>
      <label htmlFor={id}>
        {def.label}
        {def.secret ? <span title="Encrypted at rest"> 🔒</span> : null}
      </label>
      {def.type === "select" ? (
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">(default)</option>
          {def.options?.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          type={def.secret ? "password" : def.type === "number" ? "number" : "text"}
          value={value}
          placeholder={def.secret && configured ? "•••• saved (enter to replace)" : (def.placeholder ?? "")}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
        />
      )}
      {def.help ? <span className="help">{def.help}</span> : null}
    </div>
  );
}

function SettingToggle({ def, on, onToggle }: { def?: FieldDef; on: boolean; onToggle: () => void }) {
  if (!def) return null;
  return (
    <div className="toggle-row">
      <div style={{ minWidth: 0 }}>
        <div className="t">{def.label}</div>
        {def.help ? <div className="n">{def.help}</div> : null}
      </div>
      <button
        type="button"
        className={`switch${on ? " on" : ""}`}
        role="switch"
        aria-checked={on}
        aria-label={def.label}
        onClick={onToggle}
      >
        <span className="knob" />
      </button>
    </div>
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
  return (
    <div>
      <span className="label">{def.label}</span>
      <div className="range-row">
        <input
          type="range"
          min={min}
          max={max}
          value={value}
          aria-label={def.label}
          onChange={(e) => onChange(e.target.value)}
        />
        <span className="v">
          {value}
          {suffix ?? ""}
        </span>
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>{note}</div>
    </div>
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

  const saveBar = (testLabel?: string) => (
    <div className="pa-wrap mt-4">
      <button type="button" className="btn primary" onClick={save} disabled={saving}>
        {saving ? "Saving…" : "Save"}
      </button>
      {tab !== "agent" && (
        <button type="button" className="btn ghost" onClick={test} disabled={testing}>
          {testing ? "Testing…" : (testLabel ?? "Test connection")}
        </button>
      )}
      {msg && (
        <span style={{ fontSize: 12.5, fontWeight: 600, color: msg.ok ? "var(--ok-fg)" : "var(--bad-fg)" }}>
          {msg.ok ? "✓ " : "✗ "}
          {msg.detail}
        </span>
      )}
      {dirty && !saving && (
        <span className="pa-wrap muted" style={{ fontSize: 12, gap: 5 }}>
          <span className="dot-status warn" />
          Unsaved changes
        </span>
      )}
    </div>
  );

  return (
    <>
      <p className="muted" style={{ fontSize: 13, margin: "-14px 0 18px" }}>{active.sub}</p>

      <div className="pa-wrap mb-4" role="tablist" aria-label="Settings sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`chip-btn tab${tab === t.id ? " on" : ""}`}
            onClick={() => setTab(t.id)}
          >
            <span className="dot" style={{ background: health[t.id] ? "var(--ok-dot)" : "var(--warn-dot)" }} />
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Agent ── */}
      {tab === "agent" && (
        <div className="card pad">
          {toggle("PO_AGENT_ENABLED", defaults.enabled)}
          {toggle("PO_AGENT_FIRST_ORDER_CONFIRM", defaults.firstOrderConfirm)}
          {toggle("PO_AGENT_SIMULATOR_SEND", defaults.simulatorSend)}
          {toggle("PO_AGENT_SIMULATOR_SEND_EMAILS", defaults.simulatorSendEmails)}

          <div className="pa-form2 mt-4">
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
          </div>

          <div className="pa-form2 mt-4">
            {field("PO_AGENT_MODE")}
            {field("PO_AGENT_DAILY_SUBMIT_CAP")}
            {field("PO_AGENT_PO_PAYMENT_CODES", true)}
          </div>

          {saveBar()}
        </div>
      )}

      {/* ── AI model ── */}
      {tab === "ai" && (
        <div className="card pad">
          <p className="muted" style={{ marginTop: 0, fontSize: 13, lineHeight: 1.6 }}>
            Bring your own model as <span className="num">provider:model-id</span>. Omit it entirely and the built-in
            heuristic extractor runs free of charge — an LLM is much better on messy PDFs.
          </p>
          <div className="pa-form2">
            {field("PO_AGENT_MODEL")}
            {field("ANTHROPIC_API_KEY")}
            {field("OPENAI_API_KEY")}
            {field("GOOGLE_GENERATIVE_AI_API_KEY")}
          </div>
          {saveBar("Test & save")}
        </div>
      )}

      {/* ── Email channel ── */}
      {tab === "channel" && (
        <div className="card pad">
          <div className="segmented mb-3">
            {(["google", "microsoft"] as const).map((c) => (
              <button
                key={c}
                type="button"
                className={selectedChannel === c ? "on" : ""}
                onClick={() => set("PO_AGENT_CHANNEL", c)}
              >
                {c === "google" ? "Gmail" : "Microsoft Graph"}
              </button>
            ))}
          </div>

          <div className="pa-form2">
            {field("PO_AGENT_MAILBOX")}
            {field("PO_AGENT_INBOUND_SECRET")}
          </div>

          {selectedChannel === "google" ? (
            <>
              <div className="pa-form2 mt-3">
                {field("GOOGLE_PO_CLIENT_ID")}
                {field("GOOGLE_PO_CLIENT_SECRET")}
                {field("GOOGLE_PO_REFRESH_TOKEN")}
                {field("GOOGLE_PO_PUBSUB_TOPIC")}
              </div>
              <div className="mt-4">
                <span className="label">Connect the mailbox</span>
                <GmailConnect origin={origin} />
              </div>
            </>
          ) : (
            <div className="pa-form2 mt-3">
              {field("MS_PO_TENANT_ID")}
              {field("MS_PO_CLIENT_ID")}
              {field("MS_PO_CLIENT_SECRET")}
              {field("MS_PO_MAILBOX")}
            </div>
          )}

          {saveBar("Test channel")}
        </div>
      )}

      {/* ── Escalation ── */}
      {tab === "escalation" && (
        <div className="card pad">
          {field("PO_AGENT_ESCALATION_EMAIL")}
          {field("PO_AGENT_SLACK_WEBHOOK_URL")}
          <p className="faint" style={{ fontSize: 12 }}>
            Escalations always land in the Inbox; email and Slack are extra nudges.
          </p>
          {toggle("PO_AGENT_FORWARD_PRICE_MISMATCH", defaults.forwardPriceMismatch)}
          {saveBar("Send test")}
        </div>
      )}

      {/* ── Store ── */}
      {tab === "store" && (
        <div className="card pad">
          <p className="muted" style={{ marginTop: 0, fontSize: 13, lineHeight: 1.6 }}>
            Installing the app supplies its own per-store OAuth token automatically. These fields are the manual
            single-store override.
          </p>
          <div className="pa-form2">
            {field("BIGCOMMERCE_STORE_HASH")}
            {field("BIGCOMMERCE_ACCESS_TOKEN")}
            {field("BIGCOMMERCE_CHANNEL_ID")}
          </div>

          <div className="mt-4">
            <span className="label">Installed stores</span>
            {installs.length ? (
              <div className="card">
                {installs.map((i) => (
                  <div className="pa-row" key={i.storeHash}>
                    <div className="pa-grow">
                      <div className="num" style={{ fontSize: 13, fontWeight: 600, color: "var(--head)" }}>
                        {i.storeHash}
                      </div>
                      <div className="r-sub">{i.ownerEmail ?? "unknown owner"}</div>
                    </div>
                    <span className="r-meta num">{i.installedAt.slice(0, 16).replace("T", " ")}</span>
                    <span className="tag">OAuth (per-store)</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted mb-0" style={{ fontSize: 12.5 }}>
                No app installs yet — the agent uses the deployment (env/global) settings.
              </p>
            )}
          </div>

          {saveBar("Test store")}
        </div>
      )}
    </>
  );
}
