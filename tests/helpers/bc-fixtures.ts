import type { MockRoute } from "./mock-fetch";

// Reusable mock-fetch route sets modeling a "terms company" store for pipeline tests.
// Buyer buyer@acme.com (customer 42, company 123, group 7, role senior-buyer), with two
// SKUs: WIDGET-100 (product 80 / variant 64, $9.84) and BOLT-250 (product 81 / variant
// 810, $2.10). Company has pay-on-account enabled and credit.

export interface StoreOpts {
  usersEmpty?: boolean; // unknown sender
  role?: string; // "0" | "1" | "2"
  approved?: boolean;
  poEnabled?: boolean;
  creditEnabled?: boolean;
  creditHold?: boolean;
  limitPurchases?: boolean;
  availableCredit?: number;
  quoteEnabled?: boolean;
}

export function termsReads(o: StoreOpts = {}): MockRoute[] {
  const {
    usersEmpty = false,
    role = "1",
    approved = true,
    poEnabled = true,
    creditEnabled = true,
    creditHold = false,
    limitPurchases = false,
    availableCredit = 100000,
    quoteEnabled = true,
  } = o;

  return [
    {
      url: "/users?email=",
      body: {
        code: 200,
        data: usersEmpty
          ? []
          : [{ id: 1, email: "buyer@acme.com", role, customerId: 42, companyId: 123, channelList: [{ channelId: 1 }] }],
      },
    },
    // Company sub-resources must precede the generic /companies/123 route.
    {
      url: "/companies/123/payments",
      body: { code: 200, data: [{ paymentId: 1, code: "purchase_order", paymentTitle: "Pay on Account", isEnabled: poEnabled }] },
    },
    {
      url: "/companies/123/credit",
      body: { code: 200, data: { creditEnabled, creditHold, limitPurchases, availableCredit, creditCurrency: "USD" } },
    },
    {
      url: "/companies/123",
      body: { code: 200, data: { companyId: 123, companyName: "Acme Industrial", companyStatus: approved ? 1 : 0, bcGroupId: 7 } },
    },
    {
      url: "/addresses?companyId=123",
      body: { code: 200, data: [{ addressId: 2, firstName: "Jane", lastName: "Doe", addressLine1: "1 Market St", city: "Austin", stateCode: "TX", stateName: "Texas", countryCode: "US", zipCode: "78701", isDefaultBilling: 1, isDefaultShipping: 1 }] },
    },
    {
      url: "/api/v2/rfq/configs",
      body: { data: [{ key: "quote_customer", value: quoteEnabled ? 1 : 0 }, { key: "quote_for_b2b", value: quoteEnabled ? 1 : 0 }] },
    },
    // Catalog resolution.
    { url: "/v3/catalog/variants?sku:in=", body: { data: [{ id: 64, product_id: 80, sku: "WIDGET-100" }] } },
    { url: "/v3/catalog/products?sku:in=", body: { data: [{ id: 81, sku: "BOLT-250", variants: [{ id: 810, sku: "BOLT-250", product_id: 81 }] }] } },
    {
      url: "/v3/catalog/products?id:in=",
      body: {
        data: [
          { id: 80, name: "Widget", sku: "WIDGET-100", is_visible: true, availability: "available", inventory_tracking: "none", inventory_level: 0, order_quantity_minimum: 0, order_quantity_maximum: 0 },
          { id: 81, name: "Bolt", sku: "BOLT-250", is_visible: true, availability: "available", inventory_tracking: "none", inventory_level: 0, order_quantity_minimum: 0, order_quantity_maximum: 0 },
        ],
      },
    },
    // Pricing.
    {
      method: "POST",
      url: "/v3/pricing/products",
      body: {
        data: [
          { product_id: 80, variant_id: 64, calculated_price: { as_entered: 9.84, tax_exclusive: 9.84, tax_inclusive: 10.6, entered_inclusive: false } },
          { product_id: 81, variant_id: 810, calculated_price: { as_entered: 2.1, tax_exclusive: 2.1, tax_inclusive: 2.3, entered_inclusive: false } },
        ],
      },
    },
  ];
}

/** Write routes for the terms-order placement + finalization (order path). */
export function orderWrites(): MockRoute[] {
  return [
    {
      method: "POST",
      url: "/v3/carts",
      body: {
        data: {
          id: "cart1",
          customer_id: 42,
          channel_id: 1,
          line_items: {
            physical_items: [
              { id: "pi1", product_id: 80, variant_id: 64, quantity: 10 },
              { id: "pi2", product_id: 81, variant_id: 810, quantity: 40 },
            ],
          },
        },
      },
    },
    { method: "POST", url: "/billing-address", body: { data: {} } },
    { method: "POST", url: "/consignments", body: { data: { id: "cart1", consignments: [{ id: "cons1", available_shipping_options: [{ id: "opt1", cost: 15, description: "Ground" }] }] } } },
    { method: "PUT", url: "/consignments/cons1", body: { data: { id: "cart1", grand_total: 178.4, subtotal_ex_tax: 162.4, tax_total: 1, shipping_cost_total_inc_tax: 15 } } },
    { method: "POST", url: "/checkouts/cart1/orders", body: { data: { id: 9001 } } },
    { method: "PUT", url: "/v2/orders/9001", body: {} },
    // Finalization (B2B Edition).
    { method: "GET", url: "/io/orders/9001", body: { code: 200, data: { id: 555, bcOrderId: 9001, poNumber: null, invoiceId: null } } },
    { method: "PUT", url: "/io/orders/9001", body: { code: 200, data: {} } },
    { method: "POST", url: "/ip/orders/555/invoices", body: { code: 200, data: { id: 777, invoiceNumber: "INV-777" } } },
  ];
}

/** Write routes for quote creation + checkout link (quote path). */
export function quoteWrites(): MockRoute[] {
  return [
    { method: "POST", url: "/rfq/9001/checkout", body: { code: 200, data: { checkoutUrl: "https://store/checkout?q=9001", cartId: "qc1", cartUrl: "https://store/cart.php?q=9001" } } },
    { method: "POST", url: /\/rfq$/, body: { code: 200, data: { id: 9001, quoteNumber: "Q-9001", quoteUrl: "https://portal/quote/9001" } } },
  ];
}
