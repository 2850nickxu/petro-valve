"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import type { ReplyTemplate } from "@/lib/po-agent/reply-templates";

// "Reply to the buyer" card. Templates are computed server-side from the session's own
// resolved lines and passed in, so clicking one only ever drafts figures the pipeline
// actually calculated. The operator can edit freely before sending.

export function ReplyBox({
  sessionId,
  mailbox,
  templates,
  canSend,
  disabledReason,
}: {
  sessionId: string;
  mailbox?: string;
  templates: ReplyTemplate[];
  canSend: boolean;
  disabledReason?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  async function send() {
    const body = text.trim();
    if (!body) {
      toast.error("Write a reply first.");
      return;
    }
    setSending(true);
    try {
      const res = await fetch(`/api/staff/po-inbox/${encodeURIComponent(sessionId)}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: body }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success(mailbox ? `Reply sent on the thread from ${mailbox}.` : "Reply sent on the thread.");
        setText("");
        router.refresh();
      } else {
        toast.error(json.error ?? `Send failed (HTTP ${res.status}).`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Send failed.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="card mb-3">
      <div className="card-head">
        <span>Reply to the buyer</span>
        {mailbox ? (
          <span className="faint" style={{ fontSize: 11.5, fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
            sends as <span className="num">{mailbox}</span> on the same email thread
          </span>
        ) : null}
      </div>
      <div className="card-body">
        {canSend ? (
          <>
            <div className="pa-wrap mb-2">
              {templates.map((t) => (
                <button key={t.id} type="button" className="chip-btn ghost" onClick={() => setText(t.text)}>
                  {t.label}
                </button>
              ))}
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Write a reply — it goes out on the buyer's thread, from the app's mailbox."
              style={{ height: 92, fontSize: 13 }}
              aria-label="Reply body"
            />
            <div className="pa-wrap mt-2">
              <button type="button" className="btn primary" onClick={send} disabled={sending}>
                {sending ? "Sending…" : "Send reply"}
              </button>
              <span className="faint" style={{ fontSize: 11.5 }}>
                Your reply is logged in the audit trail. The session keeps its current state until you force a decision
                or dismiss it.
              </span>
            </div>
          </>
        ) : (
          <p className="muted mb-0" style={{ marginTop: 0 }}>
            {disabledReason ?? "Replying is unavailable until an email channel is configured."}
          </p>
        )}
      </div>
    </div>
  );
}
