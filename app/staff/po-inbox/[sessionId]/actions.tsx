"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm";

type ForceAction = "force_order" | "force_quote" | "dismiss";

const LABELS: Record<ForceAction, string> = {
  force_order: "Force order",
  force_quote: "Force quote",
  dismiss: "Dismiss",
};

export function SessionActions({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");

  async function post(path: string, body: Record<string, unknown>) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, state: json.state as string | undefined, error: (json.error as string) ?? (res.ok ? undefined : `HTTP ${res.status}`) };
  }

  async function runAction(action: ForceAction) {
    const ok = await confirm({
      title: `${LABELS[action]}?`,
      body: action === "dismiss"
        ? "This closes the session as rejected and removes it from the review queue."
        : `This places a real ${action === "force_order" ? "order" : "quote"} in BigCommerce from the resolved lines below. This can't be undone from here.`,
      confirmLabel: LABELS[action],
      danger: action === "dismiss" || action === "force_order",
    });
    if (!ok) return;
    setBusy(action);
    const r = await post(`/api/staff/po-inbox/${encodeURIComponent(sessionId)}/action`, { action, note: note.trim() || undefined });
    setBusy(null);
    if (r.ok) {
      toast.success(`${LABELS[action]} done${r.state ? ` → ${r.state}` : ""}.`);
      setNote("");
      router.refresh();
    } else {
      toast.error(`${LABELS[action]} failed: ${r.error}`);
    }
  }

  async function reprocess() {
    setBusy("reprocess");
    const r = await post(`/api/staff/po-inbox/${encodeURIComponent(sessionId)}/reprocess`, {});
    setBusy(null);
    if (r.ok) {
      toast.success("Re-evaluated against current store data.");
      router.refresh();
    } else {
      toast.error(`Reprocess failed: ${r.error}`);
    }
  }

  async function addNote() {
    if (!note.trim()) { toast.info("Type a note first."); return; }
    setBusy("add_note");
    const r = await post(`/api/staff/po-inbox/${encodeURIComponent(sessionId)}/action`, { action: "add_note", note: note.trim() });
    setBusy(null);
    if (r.ok) {
      toast.success("Note added to the audit trail.");
      setNote("");
      router.refresh();
    } else {
      toast.error(`Couldn't add note: ${r.error}`);
    }
  }

  const disabled = busy != null;

  return (
    <div className="stack">
      <div className="wrap">
        <button className="btn secondary" onClick={reprocess} disabled={disabled}>
          {busy === "reprocess" ? "Re-evaluating…" : "Reprocess"}
        </button>
        <button className="btn primary" onClick={() => runAction("force_order")} disabled={disabled}>
          {busy === "force_order" ? "Placing…" : "Force order"}
        </button>
        <button className="btn" onClick={() => runAction("force_quote")} disabled={disabled}>
          {busy === "force_quote" ? "Creating…" : "Force quote"}
        </button>
        <button className="btn danger" onClick={() => runAction("dismiss")} disabled={disabled}>
          {busy === "dismiss" ? "Dismissing…" : "Dismiss"}
        </button>
      </div>

      <div className="field mb-0">
        <label>Note</label>
        <textarea
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Why you're taking this action — attached to force/dismiss, or saved on its own."
        />
      </div>
      <div>
        <button className="btn sm" onClick={addNote} disabled={disabled}>
          {busy === "add_note" ? "Adding…" : "Add note only"}
        </button>
      </div>
    </div>
  );
}
