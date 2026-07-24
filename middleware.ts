import { NextResponse, type NextRequest } from "next/server";
import { isStaffAuthorized, staffSecret } from "@/lib/po-agent/staff-auth";

// Gate /staff/** and /api/staff/** behind PO_AGENT_STAFF_SECRET (?token= / Basic / cookie).
// A valid installed-app session cookie (poa_app, signed with the BC app client secret) also
// authorizes — so the admin opens inside the BigCommerce control-panel iframe. Open in
// local dev when no secret is set; closed in production.

export const config = {
  matcher: ["/staff/:path*", "/api/staff/:path*", "/app-panel/:path*"],
};

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function verifyAppSession(value: string | undefined, secret: string | undefined): Promise<boolean> {
  if (!value || !secret) return false;
  const i = value.lastIndexOf(".");
  if (i < 0) return false;
  const storeHash = value.slice(0, i);
  const sig = value.slice(i + 1);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(storeHash));
  return b64url(new Uint8Array(mac)) === sig;
}

export async function middleware(req: NextRequest) {
  const secret = staffSecret();
  const token = req.nextUrl.searchParams.get("token");
  const cookie = req.cookies.get("poa_staff")?.value ?? null;
  const auth = req.headers.get("authorization") ?? "";
  const basic = auth.startsWith("Basic ") ? auth.slice(6) : null;
  const devOpen = process.env.NODE_ENV !== "production";

  const appOk = await verifyAppSession(req.cookies.get("poa_app")?.value, process.env.BC_APP_CLIENT_SECRET);

  if (!appOk && !isStaffAuthorized({ token, cookie, basic }, secret, devOpen)) {
    return new NextResponse("Unauthorized", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="PO agent staff"' },
    });
  }

  const res = NextResponse.next();
  if (token && secret) {
    res.cookies.set("poa_staff", secret, { httpOnly: true, sameSite: "lax", path: "/" });
  }
  return res;
}
