"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { Timestamp } from "@/components/ui/timestamp";
import { EmptyState } from "@/components/ui/states";
import type { SessionSummary, PoSessionState } from "@/lib/po-agent/types";

const FILTER_STATES: Array<PoSessionState | "all"> = [
  "all",
  "completed_order",
  "completed_quote",
  "clarifying",
  "awaiting_confirmation",
  "escalated",
  "rejected",
  "expired",
];

interface SearchResult {
  total: number;
  items: SessionSummary[];
  page: number;
  pageSize: number;
}

const ACTIVE_CHIP_STYLE: React.CSSProperties = {
  background: "var(--silk-sky)",
  color: "#fff",
  borderColor: "var(--silk-sky)",
};

const PAGE_SIZE = 25;

export function SessionsBrowser() {
  const [q, setQ] = useState("");
  const [state, setState] = useState<PoSessionState | "all">("all");
  const [page, setPage] = useState(0);
  const [data, setData] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);

  // Debounced search text
  const [debouncedQ, setDebouncedQ] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleQChange = (value: string) => {
    setQ(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQ(value), 300);
  };

  // Reset page when search params change
  const handleStateChange = (next: PoSessionState | "all") => {
    setState(next);
    setPage(0);
  };

  const handleQReset = useCallback(() => {
    setPage(0);
  }, []);

  useEffect(() => {
    handleQReset();
  }, [debouncedQ, handleQReset]);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (debouncedQ) params.set("q", debouncedQ);
    if (state !== "all") params.set("state", state);
    params.set("page", String(page));
    params.set("pageSize", String(PAGE_SIZE));

    setLoading(true);
    fetch(`/api/staff/sessions/search?${params.toString()}`)
      .then((r) => r.json() as Promise<SearchResult>)
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [debouncedQ, state, page]);

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const startItem = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const endItem = Math.min(page * PAGE_SIZE + items.length, total);
  const hasPrev = page > 0;
  const hasNext = endItem < total;

  return (
    <div className="card">
      {/* Search controls */}
      <div style={{ marginBottom: 14 }}>
        <div className="field" style={{ marginBottom: 10 }}>
          <input
            type="search"
            value={q}
            onChange={(e) => handleQChange(e.target.value)}
            placeholder="Search company, buyer email, or PO number…"
          />
        </div>

        <div className="toolbar">
          {FILTER_STATES.map((st) => (
            <button
              key={st}
              type="button"
              className="tag"
              style={state === st ? ACTIVE_CHIP_STYLE : undefined}
              onClick={() => handleStateChange(st)}
            >
              {st}
            </button>
          ))}
        </div>
      </div>

      {/* Results */}
      {loading ? (
        <p className="muted" style={{ margin: "16px 0" }}>Searching…</p>
      ) : items.length === 0 ? (
        <EmptyState
          title="No matching sessions"
        >
          Try a different search or filter.
        </EmptyState>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Company</th>
              <th>Buyer</th>
              <th>State</th>
              <th>Decision</th>
              <th>PO</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>
                  <Link href={`/staff/po-inbox/${encodeURIComponent(item.id)}`}>
                    {item.company || "—"}
                  </Link>
                </td>
                <td className="muted">{item.email || "—"}</td>
                <td>
                  <span className={`badge ${item.state}`}>{item.state}</span>
                </td>
                <td>{item.decision ?? "—"}</td>
                <td className="mono">{item.poNumber || "—"}</td>
                <td>
                  <Timestamp iso={item.updatedAt} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Pagination footer */}
      {!loading && total > 0 && (
        <div
          className="toolbar"
          style={{ marginTop: 14, justifyContent: "space-between" }}
        >
          <span className="muted" style={{ fontSize: 12 }}>
            Showing {startItem}–{endItem} of {total}
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className="btn sm"
              disabled={!hasPrev}
              onClick={() => setPage((p) => p - 1)}
            >
              Prev
            </button>
            <button
              type="button"
              className="btn sm"
              disabled={!hasNext}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
