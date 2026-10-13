"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { Badge, Button, SegmentedControl } from "@/components/backbone";
import { messageLabel, stamp, type ThreadEntry } from "@/lib/po-agent/session-view";
import type { SessionMessage } from "@/lib/po-agent/types";

// The conversation on one session, oldest first: what the customer wrote, what the agent
// and staff sent back, internal emails and notes, and a divider per run carrying the
// decision. Client-side only for the filter and the "show all" toggle on long emails.

type Filter = "all" | "customer" | "agent" | "internal";

const BODY_CLAMP = 1200;

const num: CSSProperties = { fontVariantNumeric: "tabular-nums" };

const caption: CSSProperties = {
  fontSize: "var(--text-caption-size)",
  lineHeight: "var(--text-caption-line)",
  color: "var(--text-metadata)",
};

const stepLink: CSSProperties = { ...caption, color: "var(--text-link)", textDecoration: "none" };

function matches(e: ThreadEntry, f: Filter): boolean {
  if (f === "all") return true;
  if (e.kind === "run") return false;
  return e.side === f;
}

function Body({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > BODY_CLAMP;
  const shown = long && !open ? `${text.slice(0, BODY_CLAMP).trimEnd()}…` : text;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div
        style={{
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
          fontSize: "var(--text-body-size)",
          lineHeight: "var(--text-body-line)",
          color: "var(--text-primary)",
        }}
      >
        {shown.trim() || <span style={{ color: "var(--text-muted)" }}>(empty body)</span>}
      </div>
      {long ? (
        <div>
          <Button variant="ghost" size="micro" onClick={() => setOpen((o) => !o)}>
            {open ? "Show less" : "Show the whole email"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function Attachments({ files }: { files: NonNullable<SessionMessage["attachments"]> }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {files.map((f, i) => (
        <span
          key={i}
          style={{
            ...caption,
            padding: "1px 7px",
            border: "var(--border-w) solid var(--border-default)",
            borderRadius: "var(--radius-md)",
            background: "var(--surface-panel)",
            color: "var(--text-secondary)",
            overflowWrap: "anywhere",
          }}
        >
          {f.filename} <span style={{ color: "var(--text-muted)", ...num }}>· {Math.max(1, Math.round(f.size / 1024))} KB</span>
        </span>
      ))}
    </div>
  );
}

/** Who sent an outbound email and how: "Agent · sent automatically", "Staff · sent by …". */
function sender(m: SessionMessage): string {
  if (m.kind === "staff_reply") {
    const who = m.actor && m.actor !== "staff" ? m.actor : "Staff";
    return `${who} · sent by hand`;
  }
  return "Agent · sent automatically";
}

function StatusBadge({ m }: { m: SessionMessage }) {
  if (m.status === "failed") return <Badge tone="danger">Not delivered</Badge>;
  if (m.status === "captured") return <Badge tone="draft">Simulator, not delivered</Badge>;
  return null;
}

function StepLink({ n }: { n?: number }) {
  if (!n) return null;
  return (
    <a href={`#step-${n}`} style={stepLink}>
      Decision trail → step {n}
    </a>
  );
}

function Message({ e }: { e: Extract<ThreadEntry, { kind: "message" }> }) {
  const m = e.message;
  const customer = e.side === "customer";
  const internal = e.side === "internal";
  const failed = m.status === "failed";

  const surface: CSSProperties = customer
    ? { background: "var(--surface-sunken)", border: "var(--border-w) solid var(--border-default)" }
    : internal
      ? { background: "var(--surface-inset)", border: "var(--border-w) dashed var(--border-default)" }
      : { background: "var(--surface-panel)", border: `var(--border-w) solid ${failed ? "var(--danger-line)" : "var(--border-default)"}` };

  return (
    <article
      id={`msg-${m.id}`}
      style={{
        alignSelf: customer ? "flex-start" : internal ? "stretch" : "flex-end",
        width: internal ? "100%" : "min(100%, 88%)",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        scrollMarginTop: 72,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap", justifyContent: customer || internal ? "flex-start" : "flex-end" }}>
        <span style={{ ...caption, fontWeight: 600, color: "var(--text-primary)" }}>
          {customer ? m.from ?? "Customer" : internal ? `Internal · ${messageLabel(m).toLowerCase()}` : sender(m)}
        </span>
        <span style={{ ...caption, ...num }}>
          {m.to ? `to ${m.to} · ` : ""}
          {stamp(m.at)}
        </span>
        {!customer && !internal ? <Badge tone="neutral">{messageLabel(m)}</Badge> : null}
        <StatusBadge m={m} />
      </div>
      <div style={{ ...surface, borderRadius: "var(--radius-md)", padding: "var(--space-3)", display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        {internal ? <span style={caption}>Never sent to the customer.</span> : null}
        {m.subject ? <span style={{ ...caption, fontWeight: 600 }}>{m.subject}</span> : null}
        <Body text={m.text} />
        {m.attachments?.length ? <Attachments files={m.attachments} /> : null}
        {failed && m.error ? <span style={{ ...caption, color: "var(--danger-600)" }}>Send failed: {m.error}</span> : null}
      </div>
      <div style={{ display: "flex", justifyContent: customer || internal ? "flex-start" : "flex-end" }}>
        <StepLink n={e.stepN} />
      </div>
    </article>
  );
}

function Note({ e }: { e: Extract<ThreadEntry, { kind: "note" }> }) {
  const who = e.actor && e.actor !== "staff" ? e.actor : "Staff";
  return (
    <div
      style={{
        background: "var(--surface-inset)",
        border: "var(--border-w) solid var(--border-default)",
        borderRadius: "var(--radius-md)",
        padding: "var(--space-3)",
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <span style={caption}>
        <strong style={{ color: "var(--text-secondary)" }}>Internal note</strong> · {who} · {stamp(e.at)} · never sent to the customer
      </span>
      <span style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: "var(--text-body-size)", color: "var(--text-primary)" }}>{e.text}</span>
    </div>
  );
}

function RunDivider({ e }: { e: Extract<ThreadEntry, { kind: "run" }> }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
      <span aria-hidden="true" style={{ flex: "1 1 24px", height: 1, background: "var(--border-subtle)" }} />
      <span style={{ ...caption, flex: "0 1 auto", textAlign: "center" }}>
        <span style={num}>{stamp(e.at)}</span> · Run {e.run}: {e.summary}{" "}
        <a href={`#step-${e.stepN}`} style={stepLink}>
          step {e.stepN}
        </a>
      </span>
      <span aria-hidden="true" style={{ flex: "1 1 24px", height: 1, background: "var(--border-subtle)" }} />
    </div>
  );
}

export function SessionThread({ entries, footer }: { entries: ThreadEntry[]; footer?: ReactNode }) {
  const [filter, setFilter] = useState<Filter>("all");
  const count = (f: Filter) => entries.filter((e) => e.kind !== "run" && matches(e, f)).length;
  const shown = entries.filter((e) => matches(e, filter));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <SegmentedControl
        label="Show messages from"
        value={filter}
        onChange={(v) => setFilter(v as Filter)}
        options={[
          { value: "all", label: `All ${count("all")}` },
          { value: "customer", label: `Customer ${count("customer")}` },
          { value: "agent", label: `Agent ${count("agent")}` },
          { value: "internal", label: `Internal ${count("internal")}` },
        ]}
        style={{ alignSelf: "flex-start" }}
      />
      {shown.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          {shown.map((e) =>
            e.kind === "message" ? <Message key={e.key} e={e} /> : e.kind === "note" ? <Note key={e.key} e={e} /> : <RunDivider key={e.key} e={e} />,
          )}
        </div>
      ) : (
        <span style={{ ...caption, color: "var(--text-secondary)" }}>
          {entries.length ? "Nothing in this view." : "No messages stored for this session (it predates message capture)."}
        </span>
      )}
      {footer ? <div style={{ borderTop: "var(--border-w) solid var(--border-subtle)", paddingTop: "var(--space-4)" }}>{footer}</div> : null}
    </div>
  );
}
