import { NextResponse } from "next/server";
import { getPoAgentConfig } from "@/lib/po-agent/config";
import { effectiveEnv } from "@/lib/po-agent/effective-env";
import { sessionStoreHash } from "@/lib/bc-app/request-context";
import { tryGetMagentoContext } from "@/lib/magento/magento-context";
import { buildGuestCart, CartPreflightError, GuestCartBuildError } from "@/lib/magento/carts";
import { cartLinkConfig, signCartLink } from "@/lib/magento/cart-link";

// Build a Magento guest cart from the staff Catalog page (gated by middleware). This is one
// of the app's only two kinds of store write — create a guest cart, add items to it — and it
// is refused unless MAGENTO_GUEST_CART_WRITES is on. No email or customer is set on the cart.

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_LINES = 50;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { lines?: Array<{ sku?: string; qty?: number }> };
  const lines = (body.lines ?? []).map((l) => ({ sku: (l.sku ?? "").trim(), qty: Number(l.qty) })).filter((l) => l.sku);
  if (!lines.length) return NextResponse.json({ error: "No lines to add." }, { status: 400 });
  if (lines.length > MAX_LINES) return NextResponse.json({ error: `At most ${MAX_LINES} lines per cart.` }, { status: 400 });

  const env = await effectiveEnv((await sessionStoreHash()) ?? undefined);
  if (getPoAgentConfig(env).commerce !== "magento") {
    return NextResponse.json({ error: "Guest carts are for Magento stores." }, { status: 400 });
  }
  const ctx = tryGetMagentoContext(env);
  if (!ctx) return NextResponse.json({ error: "Connect the Magento store in Settings → Store." }, { status: 503 });
  if (!ctx.guestCartWrites) {
    return NextResponse.json(
      { error: `Guest-cart writes are off for the ${ctx.store} store. Turn them on for that store in Settings → Store.` },
      { status: 403 },
    );
  }

  try {
    const cart = await buildGuestCart(ctx, lines);
    const linkCfg = cartLinkConfig(env, ctx.baseUrl);
    return NextResponse.json({ ...cart, link: linkCfg ? signCartLink(linkCfg, cart.maskedId) : null });
  } catch (err) {
    if (err instanceof CartPreflightError) {
      return NextResponse.json({ error: "Some lines can't go in a cart. Nothing was created.", problems: err.problems }, { status: 422 });
    }
    if (err instanceof GuestCartBuildError) {
      return NextResponse.json({ error: `The cart was created but is incomplete: ${String(err.failure).slice(0, 200)}`, maskedId: err.maskedId }, { status: 502 });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message.slice(0, 200) : "Couldn't build the cart." }, { status: 502 });
  }
}
