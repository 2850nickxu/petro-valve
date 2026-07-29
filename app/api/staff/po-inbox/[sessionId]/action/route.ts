import { NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { createPoStore } from "@/lib/po-agent/store";
import { resolveRequestStoreContext } from "@/lib/bc-app/request-context";
import { submitOrder } from "@/lib/po-agent/core/submit-order";
import { submitQuote } from "@/lib/po-agent/core/submit-quote";
import { getQuoteConfigs, getQuoteExpiryDays } from "@/lib/bc/quote-config";

// Staff review-queue actions (gated by middleware). Dismiss is Redis-only; force order/
// quote re-run the submission against the stored session's resolution.

export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const id = decodeURIComponent(sessionId);
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "redis unavailable" }, { status: 503 });
  const store = createPoStore(redis);
  const session = await store.loadSession(id);
  if (!session) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { action, note, actor } = (await req.json().catch(() => ({}))) as { action?: string; note?: string; actor?: string };
  const now = () => new Date().toISOString();
  const by = actor?.trim() || "staff";
  const trimmedNote = note?.trim() || undefined;

  // Append-only note — no state change, stays in the queue.
  if (action === "add_note") {
    if (!trimmedNote) return NextResponse.json({ error: "note is required" }, { status: 400 });
    session.audit.push({ at: now(), event: "note", note: trimmedNote, actor: by });
    await store.saveSession(session);
    return NextResponse.json({ ok: true, state: session.state });
  }

  if (action === "dismiss") {
    session.state = "rejected";
    session.audit.push({ at: now(), event: "dismissed", note: trimmedNote, actor: by });
    await store.dequeue("escalated", id);
    await store.saveSession(session);
    return NextResponse.json({ ok: true, state: session.state });
  }

  if (action === "force_order" || action === "force_quote") {
    if (!session.buyer || !session.resolution) {
      return NextResponse.json({ error: "session missing buyer or resolution" }, { status: 400 });
    }
    const ctx = await resolveRequestStoreContext();
    if (!ctx) return NextResponse.json({ error: "BigCommerce store context not configured" }, { status: 503 });
    const channelId = session.channelId ?? ctx.channelId;

    if (action === "force_order") {
      const res = await submitOrder(ctx, {
        buyer: session.buyer,
        channelId,
        resolvedLines: session.resolution,
        extracted: session.extracted!,
        poNumber: session.extracted?.poNumber ?? undefined,
        credit: null,
      });
      if (!res.ok) return NextResponse.json({ error: res.reason }, { status: 400 });
      session.state = "completed_order";
      session.result = { orderId: res.orderId };
    } else {
      const qc = await getQuoteConfigs(ctx);
      const res = await submitQuote(ctx, {
        buyer: session.buyer,
        channelId,
        resolvedLines: session.resolution,
        poNumber: session.extracted?.poNumber ?? undefined,
        expiryDays: getQuoteExpiryDays(qc),
      });
      if (!res.ok) return NextResponse.json({ error: res.reason }, { status: 400 });
      session.state = "completed_quote";
      session.result = { quoteId: res.quoteId, quoteNumber: res.quoteNumber, checkoutUrl: res.checkoutUrl, quoteUrl: res.quoteUrl };
    }

    session.audit.push({ at: now(), event: `forced_${action}`, note: trimmedNote, actor: by });
    await store.dequeue("escalated", id);
    await store.saveSession(session);
    return NextResponse.json({ ok: true, state: session.state, result: session.result });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
