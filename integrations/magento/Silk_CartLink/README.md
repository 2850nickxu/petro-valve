# Silk_CartLink (Magento 2 module)

Opens a guest cart from a signed link in a PO agent quote email. The agent creates a guest cart
through the REST API, then emails

```
https://{store}/silkcartlink/cart/open?cart={maskedCartId}&exp={unix seconds}&sig={signature}
```

The module checks the signature and expiry, puts that cart in the visitor's session and
redirects to `/checkout/cart`. If the visitor is signed in, the guest cart is merged into
their own cart (the same merge Magento runs when a guest logs in), so they can pay on account.

- Opens only **active guest carts of the current store**. It never opens a customer's cart.
- Off by default. It does nothing until an admin enables it and sets the shared secret.
- Adds no tables, cron jobs, plugins or observers. One GET controller, two config values.

> **Status: untested.** Written against Magento 2.4 Open Source APIs and kept PHP 7.4
> compatible, because production may run a 2.4 release older than 2.4.4. It has not been run
> yet. Test it on the sandbox (`petrovalve-test.epicorcommerce.com`) before production.

## Install

Copy this folder to `app/code/Silk/CartLink/` on the store, then:

```bash
bin/magento module:enable Silk_CartLink
bin/magento setup:upgrade
bin/magento setup:di:compile        # production mode
bin/magento cache:flush
```

## Configure

1. Go to **Stores › Configuration › Silk › Cart links**, set **Enabled = Yes**, and paste the
   **Shared secret**. It is stored encrypted.
2. Put the same secret in the PO agent as `MAGENTO_CART_LINK_SECRET`.

Generate the secret once and use it on both sides:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

The sandbox and production can share one secret or use separate ones. If they're separate, the
agent's `MAGENTO_CART_LINK_SECRET` must match whichever store `MAGENTO_STORE` points at.

## Signature

```
sig = base64url( HMAC-SHA256( secret, "{maskedCartId}.{exp}" ) )   // no "=" padding
```

Test vector (asserted in `tests/magento/cart-link.test.ts` on the agent side):

| secret | cart | exp | sig |
|---|---|---|---|
| `test-secret-do-not-use` | `M4sk3dC4rt1d000000000000000000ab` | `1790000000` | `o1Q0perHalq1gPwnSGigg30oGSn1A9UiUrytAewBPKs` |

Check it on the store with:

```bash
php -r 'echo rtrim(strtr(base64_encode(hash_hmac("sha256","M4sk3dC4rt1d000000000000000000ab.1790000000","test-secret-do-not-use",true)),"+/","-_"),"="), PHP_EOL;'
```

## Test on the sandbox

1. In the PO agent, set `MAGENTO_STORE=sandbox`, `MAGENTO_SANDBOX_GUEST_CART_WRITES=true` and
   `MAGENTO_CART_LINK_SECRET` to the same secret as the module.
2. In **Staff › Catalog**, look up `VO 12111-1, 1` and click **Create guest cart**. The page
   shows the signed link.
3. Open the link in a private window. You should land on `/checkout/cart` with the item in it.
4. Open it again after signing in as a test customer. The item should be merged into that
   customer's cart.
5. Change one character of `sig`, or use an expired link. You should see "This cart link is
   invalid or has expired" and an empty cart.
