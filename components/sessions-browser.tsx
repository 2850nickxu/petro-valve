"use client";

import Link from "next/link";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button, DataTable, Panel, SearchInput, Spinner, TabPanel, Tabs, type Column } from "@/components/backbone";
import { Chip, stateLabel } from "@/app/staff/ui";
import { EmptyState } from "@/components/ui/states";
import { stamp } from "@/lib/po-agent/session-view";
import type { SessionSummary, PoSessionState } from "@/lib/po-agent/types";

// Session search: one tab per session state (with counts), and a row per session that
// says who the customer is, how far the PO got and why — without opening it.

type TabId = "all" | PoSessionState;

/** Tab order follows the work: what needs a person first, finished and closed last. */
const TABS: Array<{ id: TabId; label: string }> = [
  { id: "all", label: "All" },
  { id: "escalated", label: "Escalated" },
  { id: "clarifying", label: "Clarifying" },
  { id: "awaiting_confirmation", label: "Awaiting confirm" },
  { id: "completed_quote", label: "Quote sent" },
  { id: "completed_order", label: "Order placed" },
  { id: "rejected", label: "Rejected" },
  { id: "expired", label: "Expired" },
];

interface SearchResult {
  total: number;
  items: SessionSummary[];
  counts: Partial<Record<PoSessionState, number>>;
  page: number;
  pageSize: number;
}

const PAGE_SIZE = 25;

function href(id: string): string {
  return `/staff/po-inbox/${encodeURIComponent(id)}`;
}

/** "3 of 4" lines with nothing open; "—" before any lines were read. */
function linesCell(s: SessionSummary): string {
  if (s.linesTotal == null || s.linesTotal === 0) return "—";
  return `${s.linesReady ?? 0} of ${s.linesTotal}`;
}

function messagesCell(s: SessionSummary): string {
  if (s.messagesIn == null) return "—";
  return `${s.messagesIn} in · ${s.messagesOut ?? 0} out`;
}

const COLUMNS: Column[] = [
  {
    key: "email",
    label: "Customer",
    primary: true,
    render: (s: SessionSummary) => (
      <Link href={href(s.id)} onClick={(e) => e.stopPropagation()} style={{ color: "inherit", textDecoration: "none" }}>
        {s.email || "Unknown sender"}
      </Link>
    ),
  },
  { key: "company", label: "Company", muted: true, render: (s: SessionSummary) => s.company || "No matching account" },
  { key: "poNumber", label: "PO", mono: true, render: (s: SessionSummary) => s.poNumber || "—" },
  { key: "lines", label: "Lines ready", numeric: true, align: "right", render: linesCell },
  { key: "state", label: "Outcome", render: (s: SessionSummary) => <Chip kind={s.state}>{stateLabel(s.state)}</Chip> },
  { key: "why", label: "Why", wrap: true, width: "34%", render: (s: SessionSummary) => s.why ?? "—" },
  { key: "messages", label: "Messages", numeric: true, render: messagesCell },
  { key: "updatedAt", label: "Last activity (UTC)", numeric: true, render: (s: SessionSummary) => stamp(s.updatedAt) },
];

export function SessionsBrowser() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<TabId>("all");
  const [page, setPage] = useState(0);
  const [data, setData] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);

  const [debouncedQ, setDebouncedQ] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleQChange(value: string) {
    setQ(value);
    setPage(0);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQ(value), 300);
  }

  function handleTab(next: string) {
    setTab(next as TabId);
    setPage(0);
  }

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (debouncedQ) params.set("q", debouncedQ);
    if (tab !== "all") params.set("state", tab);
    params.set("page", String(page));
    params.set("pageSize", String(PAGE_SIZE));

    setLoading(true);
    fetch(`/api/staff/sessions/search?${params.toString()}`)
      .then((r) => r.json() as Promise<SearchResult>)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [debouncedQ, tab, page]);

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const counts = data?.counts ?? {};
  const allCount = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);
  const startItem = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const endItem = Math.min(page * PAGE_SIZE + items.length, total);
  const hasPrev = page > 0;
  const hasNext = endItem < total;

  return (
    <Panel padded={false}>
      <div style={{ padding: "var(--panel-pad)", paddingBottom: "var(--space-3)" }}>
        <SearchInput
          value={q}
          onChange={(e) => handleQChange(e.target.value)}
          placeholder="Search customer email, company, PO number or SKU"
          label="Search sessions"
          width="min(100%, 400px)"
        />
      </div>

      <Tabs
        label="Sessions by outcome"
        idPrefix="sessions"
        value={tab}
        onChange={handleTab}
        tabs={TABS.map((t) => ({ value: t.id, label: t.label, count: data ? (t.id === "all" ? allCount : counts[t.id] ?? 0) : undefined }))}
        style={{ overflowX: "auto", padding: "0 var(--panel-pad)" }}
      />

      <TabPanel value={tab} activeValue={tab} idPrefix="sessions">
        <div data-density="compact">
          {loading && !data ? (
            <div style={{ padding: "var(--panel-pad)" }}>
              <Spinner label="Searching…" />
            </div>
          ) : (
            <DataTable
              caption="Sessions, newest activity first"
              columns={COLUMNS}
              rows={items}
              minWidth={1080}
              onRowClick={(s: SessionSummary) => router.push(href(s.id))}
              emptyState={<EmptyState title="No matching sessions">Try a different search or tab.</EmptyState>}
              style={{ opacity: loading ? 0.6 : 1 }}
            />
          )}
        </div>
      </TabPanel>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, padding: "var(--panel-pad)", borderTop: "var(--border-w) solid var(--border-subtle)" }}>
        <span style={{ fontSize: "var(--text-caption-size)", color: "var(--text-metadata)", fontVariantNumeric: "tabular-nums" }}>
          {total > 0 ? `Showing ${startItem}–${endItem} of ${total} session${total === 1 ? "" : "s"}` : "No sessions"}
        </span>
        {total > PAGE_SIZE && (
          <div style={{ display: "flex", gap: 8 }}>
            <Button type="button" variant="secondary" size="micro" icon="arrow-left" disabled={!hasPrev} onClick={() => setPage((p) => p - 1)}>
              Prev
            </Button>
            <Button type="button" variant="secondary" size="micro" iconAfter="arrow-right" disabled={!hasNext} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        )}
      </div>
    </Panel>
  );
}
