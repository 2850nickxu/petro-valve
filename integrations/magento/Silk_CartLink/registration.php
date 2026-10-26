<?php
/**
 * Silk_CartLink — opens a guest cart from a signed link (see README.md).
 */
declare(strict_types=1);

use Magento\Framework\Component\ComponentRegistrar;

ComponentRegistrar::register(ComponentRegistrar::MODULE, 'Silk_CartLink', __DIR__);
