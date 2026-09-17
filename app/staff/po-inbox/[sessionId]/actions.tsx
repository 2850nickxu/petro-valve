"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, TextareaField } from "@/components/backbone";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm";

type ForceAction = "force_order" | "force_quote" | "dismiss";

const LABELS: Record<ForceAction, string> = {
  force_order: "Force order",
  force_quote: "Force quote",
  dismiss: "Dismiss",
};

/** Facts the confirm dialogs quote back, computed server-side from the session. */
export interface ActionSummary {
  poNumber?: string;
  submittable: number;
  unresolved: number;
  estimatedTotal: string;
}

async function post(path: string, body: Record<string, unknown>) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return {
    ok: res.ok,
    state: json.state as string | undefined,
    error: (json.error as string) ?? (res.ok ? undefined : `HTTP ${res.status}`),
  };
}

/** The three decision buttons (plus reprocess) that sit in the page header. */
export function SessionActionButtons({ sessionId, summary }: { sessionId: string; summary: ActionSummary }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);

  const po = summary.poNumber ? `PO ${summary.poNumber}` : "this PO";
  const unresolvedNote =
    summary.unresolved > 0
      ? ` The ${summary.unresolved} unresolved line${summary.unresolved === 1 ? "" : "s"} ${summary.unresolved === 1 ? "is" : "are"} noted in the reply.`
      : "";

  const BODIES: Record<ForceAction, string> = {
    dismiss:
      "The session moves to rejected and leaves the queue. The buyer is not notified — if they reply on the thread, " +
      "a new session starts. The email stays in the mailbox.",
    force_order:
      `Submits ${po} as a pay-on-account order with the ${summary.submittable} resolved ` +
      `line${summary.submittable === 1 ? "" : "s"} (${summary.estimatedTotal}) and replies to the buyer on the thread.` +
      unresolvedNote,
    force_quote:
      `Creates a quote for the ${summary.submittable} resolved line${summary.submittable === 1 ? "" : "s"} ` +
      `(${summary.estimatedTotal}) and sends the buyer a checkout link on the thread.` + unresolvedNote,
  };

  const CONFIRM_LABEL: Record<ForceAction, string> = {
    dismiss: "Dismiss",
    force_order: "Submit order",
    force_quote: "Create quote",
  };

  async function runAction(action: ForceAction) {
    const ok = await confirm({
      title:
        action === "dismiss"
          ? "Dismiss this session?"
          : action === "force_order"
            ? "Force this order?"
            : "Force a quote?",
      body: BODIES[action],
      confirmLabel: CONFIRM_LABEL[action],
      danger: action === "dismiss",
    });
    if (!ok) return;
    setBusy(action);
    const r = await post(`/api/staff/po-inbox/${encodeURIComponent(sessionId)}/action`, { action });
    setBusy(null);
    if (r.ok) {
      toast.success(
        action === "dismiss"
          ? "Session dismissed — state set to rejected."
          : action === "force_order"
            ? "Order submitted — buyer notified on the thread."
            : "Quote created — checkout link sent.",
      );
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

  const disabled = busy != null;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
      <Button variant="ghost" onClick={reprocess} disabled={disabled} loading={busy === "reprocess"} icon="sort">
        {busy === "reprocess" ? "Re-evaluating…" : "Reprocess"}
      </Button>
      <Button variant="destructive" onClick={() => runAction("dismiss")} disabled={disabled} loading={busy === "dismiss"}>
        {busy === "dismiss" ? "Dismissing…" : "Dismiss"}
      </Button>
      <Button variant="secondary" onClick={() => runAction("force_quote")} disabled={disabled} loading={busy === "force_quote"}>
        {busy === "force_quote" ? "Creating…" : "Force quote"}
      </Button>
      <Button variant="primary" onClick={() => runAction("force_order")} disabled={disabled} loading={busy === "force_order"}>
        {busy === "force_order" ? "Placing…" : "Force order"}
      </Button>
    </div>
  );
}

/** Internal-only note — recorded in the audit trail, never sent to the buyer. */
export function SessionNote({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function addNote() {
    if (!note.trim()) {
      toast.info("Type a note first.");
      return;
    }
    setBusy(true);
    const r = await post(`/api/staff/po-inbox/${encodeURIComponent(sessionId)}/action`, {
      action: "add_note",
      note: note.trim(),
    });
    setBusy(false);
    if (r.ok) {
      toast.success("Note added to the audit trail.");
      setNote("");
      router.refresh();
    } else {
      toast.error(`Couldn't add note: ${r.error}`);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2-5)" }}>
      <TextareaField
        label="Internal note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Internal note — recorded in the audit trail. The buyer never sees this."
        rows={3}
      />
      <div>
        <Button variant="secondary" onClick={addNote} disabled={busy} loading={busy}>
          {busy ? "Adding…" : "Add note"}
        </Button>
      </div>
    </div>
  );
}
