import { NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import {
  PREVIEW_COOKIE,
  PREVIEW_SESSION_TTL_S,
  isPreviewDeployment,
  redeemPreviewCode,
} from "@/lib/po-agent/preview-access";

// Redeem a preview sign-in code (minted on production Settings) and open a preview
// session. Outside the middleware matcher — this IS the sign-in. Only exists on Vercel
// preview deployments; production and local dev 404.

export const runtime = "nodejs";

/** Only same-origin staff paths; anything else lands on /staff. */
function safeNext(next: FormDataEntryValue | null): string {
  const s = typeof next === "string" ? next : "";
  return /^\/(staff|app-panel)(\/|\?|$)/.test(s) ? s : "/staff";
}

export async function POST(req: Request) {
  if (!isPreviewDeployment()) return new NextResponse("Not found", { status: 404 });

  const form = await req.formData();
  const next = safeNext(form.get("next"));
  const redis = getRedis();
  const redeemed = redis ? await redeemPreviewCode(redis, String(form.get("code") ?? "")) : null;

  if (!redeemed) {
    const back = new URL("/preview-login", req.url);
    back.searchParams.set("error", redis ? "invalid" : "redis");
    back.searchParams.set("next", next);
    return NextResponse.redirect(back, 303);
  }

  const res = NextResponse.redirect(new URL(next, req.url), 303);
  res.cookies.set(PREVIEW_COOKIE, redeemed.sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: PREVIEW_SESSION_TTL_S,
  });
  return res;
}
