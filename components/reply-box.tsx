"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Flex, Panel, Text, Textarea } from "@bigcommerce/big-design";
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
      header="Reply to the buyer"
      description={
        mailbox ? (
          <Text color="secondary60" marginBottom="none" style={{ fontSize: 11.5 }}>
            sends as <span style={{ fontFamily: "monospace" }}>{mailbox}</span> on the same email thread
          </Text>
        ) : undefined
      }
    >
      {canSend ? (
        <>
          <Flex flexWrap="wrap" marginBottom="small" style={{ gap: 8 }}>
            {templates.map((t) => (
              <Button key={t.id} variant="subtle" onClick={() => setText(t.text)}>
                {t.label}
              </Button>
            ))}
          </Flex>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Write a reply — it goes out on the buyer's thread, from the app's mailbox."
            rows={4}
            aria-label="Reply body"
            style={{ fontSize: 13 }}
          />
          <Flex alignItems="center" flexWrap="wrap" marginTop="small" style={{ gap: 12 }}>
            <Button variant="primary" onClick={send} isLoading={sending}>
              {sending ? "Sending…" : "Send reply"}
            </Button>
            <Text color="secondary60" marginBottom="none" style={{ fontSize: 11.5 }}>
              Your reply is logged in the audit trail. The session keeps its current state until you force a decision
              or dismiss it.
            </Text>
          </Flex>
        </>
      ) : (
        <Text color="secondary60" marginBottom="none">
          {disabledReason ?? "Replying is unavailable until an email channel is configured."}
        </Text>
      )}
    </Panel>
  );
}
