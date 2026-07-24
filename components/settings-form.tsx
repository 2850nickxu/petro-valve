"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

export interface FieldDef {
  key: string;
  label: string;
  group: string;
  secret?: boolean;
  type?: "text" | "number" | "select" | "bool";
  options?: string[];
  placeholder?: string;
}

type View = Record<string, { value: string; set: boolean; secret: boolean }>;

export function SettingsForm({ fields, view }: { fields: FieldDef[]; view: View }) {
  const router = useRouter();
  const initial = useMemo(() => {
    const v: Record<string, string> = {};
    for (const f of fields) v[f.key] = f.secret ? "" : view[f.key]?.value ?? "";
    return v;
  }, [fields, view]);

  const [values, setValues] = useState<Record<string, string>>(initial);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testMsg, setTestMsg] = useState<Record<string, { ok: boolean; detail: string }>>({});

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
      setTestMsg((m) => ({ ...m, [group]: { ok: Boolean(json.ok), detail: json.detail ?? (res.ok ? "ok" : "failed") } }));
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
    setMsg(null);
    try {
      const res = await fetch("/api/staff/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const json = await res.json();
      setMsg(res.ok ? `Saved (${json.scope}).` : `Error: ${json.error ?? res.status}`);
      if (res.ok) router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      {Object.entries(groups).map(([group, list]) => (
        <div className="card" key={group} style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <h3 style={{ marginBottom: 0 }}>{group}</h3>
            {GROUP_TARGET[group] && (
              <div className="toolbar">
                {testMsg[group] && (
                  <span style={{ color: testMsg[group].ok ? "var(--success)" : "var(--danger)", fontSize: 13 }}>
                    {testMsg[group].ok ? "✓ " : "✗ "}{testMsg[group].detail}
                  </span>
                )}
                <button className="btn" style={{ padding: "5px 12px", fontSize: 13 }} onClick={() => test(group)} disabled={testing != null}>
                  {testing === group ? "Testing…" : "Test connection"}
                </button>
              </div>
            )}
          </div>
          <div className="settings-grid" style={{ marginTop: 14 }}>
            {list.map((f) => (
              <div className="field" key={f.key}>
                <label>{f.label}{f.secret && <span className="lock" title="Encrypted at rest"> 🔒</span>}</label>
                {f.type === "bool" ? (
                  <select value={values[f.key]} onChange={(e) => set(f.key, e.target.value)}>
                    <option value="">(default)</option>
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                ) : f.type === "select" ? (
                  <select value={values[f.key]} onChange={(e) => set(f.key, e.target.value)}>
                    <option value="">(default)</option>
                    {f.options?.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input
                    type={f.secret ? "password" : f.type === "number" ? "number" : "text"}
                    value={values[f.key]}
                    placeholder={f.secret && view[f.key]?.set ? "•••••••• configured (leave blank to keep)" : f.placeholder ?? ""}
                    onChange={(e) => set(f.key, e.target.value)}
                    autoComplete="off"
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className="toolbar" style={{ position: "sticky", bottom: 0, padding: "12px 0", background: "var(--bg)" }}>
        <button className="btn primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save settings"}</button>
        {msg && <span className="muted">{msg}</span>}
      </div>
    </div>
  );
}
