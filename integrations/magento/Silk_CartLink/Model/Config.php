<?php
declare(strict_types=1);

namespace Silk\CartLink\Model;

use Magento\Framework\App\Config\ScopeConfigInterface;
use Magento\Framework\Encryption\EncryptorInterface;
use Magento\Store\Model\ScopeInterface;

/**
 * Admin settings: Stores > Configuration > Silk > Cart links.
 * PHP 7.4-compatible on purpose: production may run a Magento 2.4 release older than 2.4.4.
 */
class Config
{
    private const XML_ENABLED = 'silk_cartlink/general/enabled';
    private const XML_SECRET = 'silk_cartlink/general/secret';

    /** @var ScopeConfigInterface */
    private $scopeConfig;

    /** @var EncryptorInterface */
    private $encryptor;

    public function __construct(ScopeConfigInterface $scopeConfig, EncryptorInterface $encryptor)
    {
        $this->scopeConfig = $scopeConfig;
        $this->encryptor = $encryptor;
    }

    public function isEnabled(): bool
    {
        return $this->scopeConfig->isSetFlag(self::XML_ENABLED, ScopeInterface::SCOPE_WEBSITE);
    }

    /** The shared secret, decrypted ('' when unset). */
    public function getSecret(): string
    {
        $stored = (string) $this->scopeConfig->getValue(self::XML_SECRET, ScopeInterface::SCOPE_WEBSITE);
        return $stored === '' ? '' : trim((string) $this->encryptor->decrypt($stored));
    }
}
