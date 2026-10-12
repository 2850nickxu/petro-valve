import { NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { sessionStoreHash } from "@/lib/bc-app/request-context";
import { createPreviewCode } from "@/lib/po-agent/preview-access";

// Mint a single-use preview sign-in code (gated by middleware). The code carries the
// caller's current store, so the preview opens on the same store and settings scope.

export const runtime = "nodejs";

export async function POST() {
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "Redis not configured — cannot issue a code." }, { status: 503 });
  const storeHash = await sessionStoreHash();
  const { code, expiresAt } = await createPreviewCode(redis, storeHash);
  return NextResponse.json({ code, expiresAt, storeHash });
}
