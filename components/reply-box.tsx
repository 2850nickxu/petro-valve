"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Panel, TextareaField } from "@/components/backbone";
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
    <Panel
      title="Reply to the buyer"
      meta={mailbox ? <>sends as <span style={{ fontFamily: "var(--font-mono)" }}>{mailbox}</span> on the same email thread</> : undefined}
    >
      {canSend ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2-5)" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {templates.map((t) => (
              <Button key={t.id} variant="ghost" size="micro" onClick={() => setText(t.text)}>
                {t.label}
              </Button>
            ))}
          </div>
          <TextareaField
            label="Reply body"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Write a reply — it goes out on the buyer's thread, from the app's mailbox."
            rows={4}
          />
          <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
            <Button variant="primary" onClick={send} loading={sending} icon="mail">
              {sending ? "Sending…" : "Send reply"}
            </Button>
            <span style={{ fontSize: "var(--text-caption-size)", color: "var(--text-metadata)" }}>
              Your reply is logged in the audit trail. The session keeps its current state until you force a decision
              or dismiss it.
            </span>
          </div>
        </div>
      ) : (
        <span style={{ color: "var(--text-secondary)" }}>
          {disabledReason ?? "Replying is unavailable until an email channel is configured."}
        </span>
      )}
    </Panel>
  );
}
