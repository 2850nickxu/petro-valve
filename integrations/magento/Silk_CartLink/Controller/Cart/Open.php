<?php
declare(strict_types=1);

namespace Silk\CartLink\Controller\Cart;

use Magento\Checkout\Model\Session as CheckoutSession;
use Magento\Customer\Model\Session as CustomerSession;
use Magento\Framework\App\Action\HttpGetActionInterface;
use Magento\Framework\App\RequestInterface;
use Magento\Framework\Controller\Result\Redirect;
use Magento\Framework\Controller\Result\RedirectFactory;
use Magento\Framework\Message\ManagerInterface;
use Magento\Quote\Api\CartRepositoryInterface;
use Magento\Quote\Model\MaskedQuoteIdToQuoteIdInterface;
use Magento\Store\Model\StoreManagerInterface;
use Psr\Log\LoggerInterface;
use Silk\CartLink\Model\Config;
use Silk\CartLink\Model\Signature;

/**
 * GET /silkcartlink/cart/open?cart={maskedId}&exp={unix}&sig={hmac}
 *
 * Verifies the PO agent's signature and expiry, then puts that guest cart in the visitor's
 * checkout session and redirects to the cart page. A signed-in customer gets the guest cart
 * merged into their own cart — the same merge Magento runs when a guest logs in. Only active
 * guest carts of the current store open; a customer's cart never does.
 * PHP 7.4-compatible on purpose (see Model\Config).
 */
class Open implements HttpGetActionInterface
{
    /** @var RequestInterface */
    private $request;
    /** @var RedirectFactory */
    private $redirectFactory;
    /** @var ManagerInterface */
    private $messageManager;
    /** @var CheckoutSession */
    private $checkoutSession;
    /** @var CustomerSession */
    private $customerSession;
    /** @var CartRepositoryInterface */
    private $cartRepository;
    /** @var MaskedQuoteIdToQuoteIdInterface */
    private $maskedQuoteIdToQuoteId;
    /** @var StoreManagerInterface */
    private $storeManager;
    /** @var Config */
    private $config;
    /** @var Signature */
    private $signature;
    /** @var LoggerInterface */
    private $logger;

    public function __construct(
        RequestInterface $request,
        RedirectFactory $redirectFactory,
        ManagerInterface $messageManager,
        CheckoutSession $checkoutSession,
        CustomerSession $customerSession,
        CartRepositoryInterface $cartRepository,
        MaskedQuoteIdToQuoteIdInterface $maskedQuoteIdToQuoteId,
        StoreManagerInterface $storeManager,
        Config $config,
        Signature $signature,
        LoggerInterface $logger
    ) {
        $this->request = $request;
        $this->redirectFactory = $redirectFactory;
        $this->messageManager = $messageManager;
        $this->checkoutSession = $checkoutSession;
        $this->customerSession = $customerSession;
        $this->cartRepository = $cartRepository;
        $this->maskedQuoteIdToQuoteId = $maskedQuoteIdToQuoteId;
        $this->storeManager = $storeManager;
        $this->config = $config;
        $this->signature = $signature;
        $this->logger = $logger;
    }

    public function execute(): Redirect
    {
        $redirect = $this->redirectFactory->create()->setPath('checkout/cart');
        if (!$this->config->isEnabled()) {
            return $redirect;
        }

        $cart = (string) $this->request->getParam('cart', '');
        $exp = (string) $this->request->getParam('exp', '');
        $sig = (string) $this->request->getParam('sig', '');
        if (!$this->signature->isValid($cart, $exp, $sig, $this->config->getSecret(), time())) {
            $this->messageManager->addErrorMessage(
                __('This cart link is invalid or has expired. Reply to your quote email and we will send a new one.')
            );
            return $redirect;
        }

        try {
            $quote = $this->cartRepository->get($this->maskedQuoteIdToQuoteId->execute($cart));
        } catch (\Exception $e) {
            $this->messageManager->addErrorMessage(__('This cart is no longer available.'));
            return $redirect;
        }

        $currentStoreId = (int) $this->storeManager->getStore()->getId();
        if (!$quote->getIsActive() || $quote->getCustomerId() || (int) $quote->getStoreId() !== $currentStoreId) {
            $this->messageManager->addErrorMessage(__('This cart is no longer available.'));
            return $redirect;
        }

        try {
            $this->checkoutSession->replaceQuote($quote);
            if ($this->customerSession->isLoggedIn()) {
                // Standard login merge: the guest cart's items move into the customer's cart.
                $this->checkoutSession->loadCustomerQuote();
            }
            $this->messageManager->addSuccessMessage(__('Your quoted items are in your cart.'));
        } catch (\Exception $e) {
            $this->logger->error('Silk_CartLink: could not open cart', ['exception' => $e]);
            $this->messageManager->addErrorMessage(__('We could not open this cart. Please contact us.'));
        }
        return $redirect;
    }
}
