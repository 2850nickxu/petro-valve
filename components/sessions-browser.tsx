"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { stateLabel } from "@/app/staff/ui";
import { EmptyState } from "@/components/ui/states";
import type { SessionSummary, PoSessionState } from "@/lib/po-agent/types";

// Session search. The design collapses the raw state list into four intent-based filters;
// each maps to the concrete states the store can return. "All" sends no state filter.

type FilterId = "all" | "escalated" | "open" | "completed";

const FILTERS: Array<{ id: FilterId; label: string; states: PoSessionState[] }> = [
  { id: "all", label: "All", states: [] },
  { id: "escalated", label: "Escalated", states: ["escalated"] },
  { id: "open", label: "In progress", states: ["clarifying", "awaiting_confirmation"] },
  { id: "completed", label: "Completed", states: ["completed_order", "completed_quote"] },
];

interface SearchResult {
  total: number;
  items: SessionSummary[];
  page: number;
  pageSize: number;
}

const PAGE_SIZE = 25;

export function SessionsBrowser() {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<FilterId>("all");
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

  function handleFilter(next: FilterId) {
    setFilter(next);
    setPage(0);
  }

  useEffect(() => {
    let cancelled = false;
    const active = FILTERS.find((f) => f.id === filter)!;

    // The search endpoint takes a single state. For multi-state filters we ask for each
    // and merge, so "In progress" and "Completed" behave like the design's chips.
    const queries = active.states.length ? active.states : [null];
    const requests = queries.map((state) => {
      const params = new URLSearchParams();
      if (debouncedQ) params.set("q", debouncedQ);
      if (state) params.set("state", state);
      params.set("page", "0");
      // Over-fetch when merging so client-side paging stays correct.
      params.set("pageSize", String(active.states.length > 1 ? 200 : PAGE_SIZE));
      if (active.states.length <= 1) params.set("page", String(page));
      return fetch(`/api/staff/sessions/search?${params.toString()}`).then((r) => r.json() as Promise<SearchResult>);
    });

    setLoading(true);
    Promise.all(requests)
      .then((results) => {
        if (cancelled) return;
        if (active.states.length > 1) {
          const merged = results
            .flatMap((r) => r.items)
            .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
          setData({
            total: merged.length,
            items: merged.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE),
            page,
            pageSize: PAGE_SIZE,
          });
        } else {
          setData(results[0]);
        }
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [debouncedQ, filter, page]);

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const startItem = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const endItem = Math.min(page * PAGE_SIZE + items.length, total);
  const hasPrev = page > 0;
  const hasNext = endItem < total;

  return (
    <div className="card">
      <div className="pa-wrap" style={{ padding: "12px 18px", borderBottom: "1px solid var(--border2)" }}>
        <input
          type="search"
          value={q}
          onChange={(e) => handleQChange(e.target.value)}
          placeholder="Search company, buyer, PO number"
          aria-label="Search sessions"
          style={{ flex: "1 1 200px", maxWidth: 300, fontSize: 13 }}
        />
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`chip-btn round${filter === f.id ? " on" : ""}`}
            aria-pressed={filter === f.id}
            onClick={() => handleFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="card-body">
          {["62%", "100%", "84%", "73%"].map((w) => (
            <div key={w} className="skeleton" style={{ width: w }} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState title="No matching sessions">Try a different search or filter.</EmptyState>
      ) : (
        items.map((item) => (
          <Link
            key={item.id}
            href={`/staff/po-inbox/${encodeURIComponent(item.id)}`}
            className="pa-row link"
          >
            <div className="pa-grow">
              <div className="r-title">{item.company || "(unknown sender)"}</div>
              <div className="r-sub">
                {item.email || "unknown"} · {item.poNumber || "no PO number"} ·{" "}
                {item.updatedAt.slice(0, 16).replace("T", " ")}
              </div>
            </div>
            <span className="r-meta num">{item.decision ?? "—"}</span>
            <span className={`chip ${item.state}`}>{stateLabel(item.state)}</span>
          </Link>
        ))
      )}

      <div className="card-foot row-between">
        <span>
          {total > 0 ? (
            <>
              Showing <span className="num">{startItem}</span>–<span className="num">{endItem}</span> of{" "}
              <span className="num">{total}</span> session{total === 1 ? "" : "s"}
            </>
          ) : (
            "No sessions"
          )}
        </span>
        {total > PAGE_SIZE && (
          <span className="pa-wrap" style={{ gap: 8 }}>
            <button type="button" className="btn xs" disabled={!hasPrev} onClick={() => setPage((p) => p - 1)}>
              Prev
            </button>
            <button type="button" className="btn xs" disabled={!hasNext} onClick={() => setPage((p) => p + 1)}>
              Next
            </button>
          </span>
        )}
      </div>
    </div>
  );
}
