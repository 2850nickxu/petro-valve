import { describe, it, expect } from "vitest";
import { getMagentoContext, magentoStore } from "@/lib/magento/magento-context";
import { buildGuestCart } from "@/lib/magento/carts";

// ─────────────────────────────────────────────────────────────────────────────
// [LM2] LIVE Magento guest-cart WRITE verification.
//
// ⚠️  THIS CREATES ONE REAL GUEST CART in the active Magento store (one line,
//     VO 12111-1 × 1). No email, customer or address is set on it, so Amasty
//     abandoned-cart mail and the HubSpot cart sync have nothing to key on. Guest
//     carts can't be deleted through the API; Magento's quote cleanup expires them.
//
// Runs against the SANDBOX only (MAGENTO_STORE=sandbox), and needs ALL of:
//     PO_AGENT_LIVE=1  PO_AGENT_LIVE_WRITE=1  MAGENTO_STORE=sandbox
//     MAGENTO_SANDBOX_GUEST_CART_WRITES=true
// Pointing it at production also needs MAGENTO_LIVE_WRITE_PRODUCTION=1 — only after
// Petro Valve has signed off on production carts. `npm test` and CI always skip it.
//
//   PO_AGENT_LIVE=1 PO_AGENT_LIVE_WRITE=1 MAGENTO_STORE=sandbox MAGENTO_SANDBOX_GUEST_CART_WRITES=true \
//     node --env-file=.env node_modules/vitest/vitest.mjs run tests/live/magento-cart-write.test.ts
// ─────────────────────────────────────────────────────────────────────────────

const store = magentoStore();
const LIVE_WRITE =
  process.env.PO_AGENT_LIVE === "1" &&
  process.env.PO_AGENT_LIVE_WRITE === "1" &&
  (store === "sandbox" || process.env.MAGENTO_LIVE_WRITE_PRODUCTION === "1");

describe.skipIf(!LIVE_WRITE)(`[LM2] live Magento — guest cart write (${store})`, () => {
  it("creates a one-line guest cart and reads its totals", async () => {
    const ctx = getMagentoContext();
    expect(ctx.guestCartWrites).toBe(true);
    const cart = await buildGuestCart(ctx, [{ sku: "VO 12111-1", qty: 1 }]);
    console.log(`[LM2] created guest cart ${cart.maskedId} on ${ctx.baseUrl}`, JSON.stringify({ totals: cart.totals, priceMismatches: cart.priceMismatches }));

    expect(cart.maskedId).toMatch(/^[A-Za-z0-9]{16,64}$/);
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0]).toMatchObject({ sku: "VO 12111-1", qty: 1 });
    expect(cart.totals.grandTotal).toBeGreaterThan(0);
  });
});
