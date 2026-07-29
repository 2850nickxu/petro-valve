import { NextResponse } from "next/server";

// Best-effort staff sign-out: clears the poa_staff cookie and returns to the landing
// page. (Basic-auth sessions can't be revoked server-side — the browser keeps resending
// credentials — but the common token/cookie flow signs out cleanly.)

export const runtime = "nodejs";

export async function GET(req: Request) {
  const res = NextResponse.redirect(new URL("/", req.url));
  res.cookies.set("poa_staff", "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
