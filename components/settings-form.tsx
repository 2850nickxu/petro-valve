"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";

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

export function SettingsForm({ fields, view }: { fields: FieldDef[]; view: View }) {
  const router = useRouter();
  const toast = useToast();

  const initial = useMemo(() => {
    const v: Record<string, string> = {};
    for (const f of fields) v[f.key] = f.secret ? "" : (view[f.key]?.value ?? "");
    return v;
  }, [fields, view]);

  const [values, setValues] = useState<Record<string, string>>(initial);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [testMsg, setTestMsg] = useState<Record<string, { ok: boolean; detail: string }>>({});

  // Track whether initial has been applied once (avoids marking dirty on first render)
  const initialRef = useRef(initial);

  // Recompute dirty whenever values change
  useEffect(() => {
    const isDirty = Object.keys(initialRef.current).some((k) => values[k] !== initialRef.current[k]);
    setDirty(isDirty);
  }, [values]);

  // Warn before leaving with unsaved changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const GROUP_TARGET: Record<string, string | ((v: Record<string, string>) => string)> = {
    AI: "ai",
    Escalation: "slack",
    "Email channel": (v) => (v.PO_AGENT_CHANNEL === "microsoft" ? "microsoft" : "gmail"),
    BigCommerce: "bigcommerce",
  };

  async function test(group: string) {
    const t = GROUP_TARGET[group];
    const target = typeof t === "function" ? t(values) : t;
    setTesting(group);
    setTestMsg((m) => ({ ...m, [group]: undefined as never }));
    try {
      const res = await fetch("/api/staff/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target, values }),
      });
      const json = await res.json();
      const ok = Boolean(json.ok);
      const detail = json.detail ?? (res.ok ? "ok" : "failed");
      setTestMsg((m) => ({ ...m, [group]: { ok, detail } }));
    } catch (e) {
      setTestMsg((m) => ({ ...m, [group]: { ok: false, detail: e instanceof Error ? e.message : "failed" } }));
    } finally {
      setTesting(null);
    }
  }

  const groups = useMemo(() => {
    const g: Record<string, FieldDef[]> = {};
    for (const f of fields) (g[f.group] ??= []).push(f);
    return g;
  }, [fields]);

  function set(key: string, val: string) {
    setValues((v) => ({ ...v, [key]: val }));
  }

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
        toast.success(`Settings saved (${json.scope}).`);
        // Reset initial baseline so dirty resets to false
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

  return (
    <div>
      {Object.entries(groups).map(([group, list]) => (
        <div className="card" key={group} style={{ marginBottom: 16 }}>
          <div className="row-between" style={{ marginBottom: 14 }}>
            <h3 style={{ marginBottom: 0 }}>{group}</h3>
            {GROUP_TARGET[group] && (
              <div className="toolbar">
                {testMsg[group] && (
                  <span
                    style={{
                      color: testMsg[group].ok ? "var(--ok)" : "var(--bad)",
                      fontSize: 12.5,
                      fontWeight: 600,
                    }}
                  >
                    {testMsg[group].ok ? "✓ " : "✗ "}
                    {testMsg[group].detail}
                  </span>
                )}
                <button
                  className="btn sm"
                  onClick={() => test(group)}
                  disabled={testing != null}
                >
                  {testing === group ? "Testing…" : "Test connection"}
                </button>
              </div>
            )}
          </div>

          <div className="settings-grid">
            {list.map((f) => (
              <div className="field" key={f.key}>
                <label>
                  {f.label}
                  {f.secret && (
                    <span className="lock" title="Encrypted at rest">
                      {" "}
                      🔒
                    </span>
                  )}
                </label>
                {f.type === "bool" ? (
                  <select value={values[f.key]} onChange={(e) => set(f.key, e.target.value)}>
                    <option value="">(default)</option>
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                ) : f.type === "select" ? (
                  <select value={values[f.key]} onChange={(e) => set(f.key, e.target.value)}>
                    <option value="">(default)</option>
                    {f.options?.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={f.secret ? "password" : f.type === "number" ? "number" : "text"}
                    value={values[f.key]}
                    placeholder={
                      f.secret && view[f.key]?.set
                        ? "•••••••• configured (leave blank to keep)"
                        : (f.placeholder ?? "")
                    }
                    onChange={(e) => set(f.key, e.target.value)}
                    autoComplete="off"
                  />
                )}
                {f.help && (
                  <span
                    className="muted"
                    style={{ display: "block", fontSize: 11.5, marginTop: 4, lineHeight: 1.45 }}
                  >
                    {f.help}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      <div
        className="toolbar"
        style={{
          position: "sticky",
          bottom: 0,
          padding: "10px 14px",
          background: "var(--panel)",
          border: "1px solid var(--line)",
          borderRadius: "var(--radius)",
          boxShadow: "0 -2px 8px rgba(4,39,45,.06)",
        }}
      >
        <button className="btn primary" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save settings"}
        </button>
        {dirty && !saving && (
          <span
            className="muted"
            style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 5 }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: "var(--warn)",
                display: "inline-block",
                flexShrink: 0,
              }}
            />
            Unsaved changes
          </span>
        )}
      </div>
    </div>
  );
}
