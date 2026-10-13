import { NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { createPoStore } from "@/lib/po-agent/store";
import type { PoSessionState } from "@/lib/po-agent/types";

// Search sessions via the HSET summary index.
// GET /api/staff/sessions/search?q=&state=&from=YYYY-MM-DD&to=YYYY-MM-DD&page=0&pageSize=25
// q matches customer email, company, PO number or SKU. `counts` = matches per state.

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? undefined;
  const stateParam = url.searchParams.get("state") ?? undefined;
  const state = stateParam ? (stateParam as PoSessionState) : undefined;

  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  const from = fromParam ? Date.parse(fromParam) : undefined;
  // Add 86_399_999 ms so "to" is end-of-day inclusive.
  const to = toParam ? Date.parse(toParam) + 86_399_999 : undefined;

  const page = Math.max(0, parseInt(url.searchParams.get("page") ?? "0", 10) || 0);
  const rawPageSize = parseInt(url.searchParams.get("pageSize") ?? "25", 10) || 25;
  const pageSize = Math.min(100, Math.max(1, rawPageSize));

  const redis = getRedis();
  if (!redis) {
    return NextResponse.json({ total: 0, items: [], counts: {}, page, pageSize });
  }

  const store = createPoStore(redis);
  const { total, items, counts } = await store.searchSessions({
    text: q,
    state,
    from: Number.isFinite(from) ? from : undefined,
    to: Number.isFinite(to) ? to : undefined,
    offset: page * pageSize,
    limit: pageSize,
  });

  return NextResponse.json({ total, items, counts, page, pageSize });
}
