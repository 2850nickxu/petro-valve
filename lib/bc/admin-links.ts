// Deep links into a store's BigCommerce control panel, so an operator reviewing a PO can
// jump straight to the resulting order or the buyer's customer record.
//
// Sourced from BigCommerce docs (control-panel URL convention):
//   https://docs.bigcommerce.com/developer/docs/storefront/catalyst/development/environment-variables
//   Base admin: https://store-{hash}.mybigcommerce.com/manage
//   Documented sections: /manage/orders , /manage/customers
//
// The record-level suffixes (/orders/{id}, /customers/{id}/edit) are the long-standing
// control-panel paths but are NOT explicitly documented — they're isolated here so a
// correction is a one-line change. All builders no-op (return undefined) without a hash.

export interface AdminLinks {
  orders: () => string;
  order: (id: number) => string;
  customers: () => string;
  customer: (id: number) => string;
}

export function adminLinks(storeHash?: string | null): AdminLinks | null {
  if (!storeHash) return null;
  const base = `https://store-${storeHash}.mybigcommerce.com/manage`;
  return {
    orders: () => `${base}/orders`,
    order: (id) => `${base}/orders/${id}`,
    customers: () => `${base}/customers`,
    customer: (id) => `${base}/customers/${id}/edit`,
  };
}
