import { NextResponse, type NextRequest } from "next/server";
import { isStaffAuthorized, staffSecret } from "@/lib/po-agent/staff-auth";
import { PREVIEW_COOKIE, isPreviewDeployment, loadPreviewSession } from "@/lib/po-agent/preview-access";
import { getRedis } from "@/lib/redis";

// Gate /staff/** and /api/staff/** behind PO_AGENT_STAFF_SECRET (?token= / Basic / cookie).
// A valid installed-app session cookie (poa_app, signed with the BC app client secret) also
// authorizes — so the admin opens inside the BigCommerce control-panel iframe. On Vercel
// previews only, a preview sign-in session (poa_preview, minted from a production code) also
// authorizes. Open in local dev when no secret is set; closed in production.

export const config = {
  matcher: ["/staff/:path*", "/api/staff/:path*", "/app-panel/:path*", "/api/gmail-oauth/:path*"],
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
    if (isPreviewDeployment()) {
      // Previews can't get the BC app session or the staff secret — accept a preview
      // sign-in session instead, and send page visits to the code-entry page.
      const redis = getRedis();
      if (redis && (await loadPreviewSession(redis, req.cookies.get(PREVIEW_COOKIE)?.value))) {
        return NextResponse.next();
      }
      if (req.method === "GET" && !req.nextUrl.pathname.startsWith("/api/")) {
        const login = new URL("/preview-login", req.url);
        login.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
        return NextResponse.redirect(login);
      }
      return new NextResponse("Unauthorized", { status: 401 });
    }
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
