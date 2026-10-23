import { describe, it, expect } from "vitest";
import { getMagentoContext } from "@/lib/magento/magento-context";
import { buildGuestCart } from "@/lib/magento/carts";

// ─────────────────────────────────────────────────────────────────────────────
// [LM2] LIVE Magento guest-cart WRITE verification.
//
// ⚠️  THIS CREATES ONE REAL GUEST CART in the store at MAGENTO_BASE_URL (one line,
//     VO 12111-1 × 1). No email, customer or address is set on it, so Amasty
//     abandoned-cart mail and the HubSpot cart sync have nothing to key on. Guest
//     carts can't be deleted through the API; Magento's quote cleanup expires them.
//
// TRIPLE-GATED so it can never fire by accident — it needs ALL of:
//     PO_AGENT_LIVE=1  PO_AGENT_LIVE_WRITE=1  MAGENTO_GUEST_CART_WRITES=true
// `npm test`, CI and the read-only [LM] run all skip it.
//
//   PO_AGENT_LIVE=1 PO_AGENT_LIVE_WRITE=1 MAGENTO_GUEST_CART_WRITES=true \
//     node --env-file=.env node_modules/vitest/vitest.mjs run tests/live/magento-cart-write.test.ts
// ─────────────────────────────────────────────────────────────────────────────

const LIVE_WRITE =
  process.env.PO_AGENT_LIVE === "1" &&
  process.env.PO_AGENT_LIVE_WRITE === "1" &&
  process.env.MAGENTO_GUEST_CART_WRITES === "true" &&
  Boolean(process.env.MAGENTO_BASE_URL && process.env.MAGENTO_ADMIN_USERNAME && process.env.MAGENTO_ADMIN_PASSWORD);

describe.skipIf(!LIVE_WRITE)("[LM2] live Magento — guest cart write", () => {
  it("creates a one-line guest cart and reads its totals", async () => {
    const cart = await buildGuestCart(getMagentoContext(), [{ sku: "VO 12111-1", qty: 1 }]);
    console.log(`[LM2] created guest cart ${cart.maskedId}`, JSON.stringify({ totals: cart.totals, priceMismatches: cart.priceMismatches }));

    expect(cart.maskedId).toMatch(/^[A-Za-z0-9]{16,64}$/);
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0]).toMatchObject({ sku: "VO 12111-1", qty: 1 });
    expect(cart.totals.grandTotal).toBeGreaterThan(0);
  });
});
