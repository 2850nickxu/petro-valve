import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getRedis } from "@/lib/redis";
import { PREVIEW_COOKIE, endPreviewSession } from "@/lib/po-agent/preview-access";

// Best-effort staff sign-out: clears the poa_staff cookie (and any preview sign-in
// session) and returns to the landing page. (Basic-auth sessions can't be revoked
// server-side — the browser keeps resending credentials — but the common token/cookie flow
// signs out cleanly.)

export const runtime = "nodejs";

export async function GET(req: Request) {
  const preview = (await cookies()).get(PREVIEW_COOKIE)?.value;
  const redis = getRedis();
  if (preview && redis) await endPreviewSession(redis, preview);

  const res = NextResponse.redirect(new URL("/", req.url));
  res.cookies.set("poa_staff", "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  if (preview) res.cookies.set(PREVIEW_COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
