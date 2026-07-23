import { NextResponse, type NextRequest } from "next/server";
import { isStaffAuthorized, staffSecret } from "@/lib/po-agent/staff-auth";

// Gate /staff/** and /api/staff/** behind PO_AGENT_STAFF_SECRET (?token=, Basic auth, or
// the poa_staff cookie). Open in local dev when no secret is set; closed in production.

export const config = {
  matcher: ["/staff/:path*", "/api/staff/:path*"],
};

export function middleware(req: NextRequest) {
  const secret = staffSecret();
  const token = req.nextUrl.searchParams.get("token");
  const cookie = req.cookies.get("poa_staff")?.value ?? null;
  const auth = req.headers.get("authorization") ?? "";
  const basic = auth.startsWith("Basic ") ? auth.slice(6) : null;
  const devOpen = process.env.NODE_ENV !== "production";

  if (!isStaffAuthorized({ token, cookie, basic }, secret, devOpen)) {
    return new NextResponse("Unauthorized", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="PO agent staff"' },
    });
  }

  const res = NextResponse.next();
  // Persist a valid ?token= as a cookie so subsequent navigation stays authorized.
  if (token && secret) {
    res.cookies.set("poa_staff", secret, { httpOnly: true, sameSite: "lax", path: "/" });
  }
  return res;
}
