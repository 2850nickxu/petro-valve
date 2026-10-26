<?php
declare(strict_types=1);

namespace Silk\CartLink\Model;

/**
 * Link signature — must match the PO agent (lib/magento/cart-link.ts):
 *   sig = base64url( HMAC-SHA256( secret, "{maskedCartId}.{exp}" ) ), no padding.
 * Test vector (README.md): secret "test-secret-do-not-use", cart
 * "M4sk3dC4rt1d000000000000000000ab", exp 1790000000 → "o1Q0perHalq1gPwnSGigg30oGSn1A9UiUrytAewBPKs".
 */
class Signature
{
    public function sign(string $cart, int $exp, string $secret): string
    {
        $mac = hash_hmac('sha256', $cart . '.' . $exp, $secret, true);
        return rtrim(strtr(base64_encode($mac), '+/', '-_'), '=');
    }

    public function isValid(string $cart, string $exp, string $sig, string $secret, int $now): bool
    {
        if ($secret === '' || $sig === '') {
            return false;
        }
        if (!preg_match('/^[A-Za-z0-9]{16,64}$/', $cart) || !preg_match('/^\d{1,12}$/', $exp)) {
            return false;
        }
        if ((int) $exp < $now) {
            return false;
        }
        return hash_equals($this->sign($cart, (int) $exp, $secret), $sig);
    }
}
