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
          <h3>{group}</h3>
          <div className="settings-grid">
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
