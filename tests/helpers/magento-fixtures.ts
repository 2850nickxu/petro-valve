// Fixtures for the read-only Magento layer: a throwaway context and mock-fetch routes that
// answer the admin-token login, `sku in (...)` / `sku like` searches and configurable children.

import type { MockRequest, MockRoute } from "./mock-fetch";

export const TEST_MAGENTO_CTX = {
  baseUrl: "https://shop.example.com",
  username: "agent",
  password: "secret-pw",
};

export interface RawFixtureProduct {
  sku: string;
  name?: string;
  price: number;
  type_id?: string;
  status?: number;
  visibility?: number;
  custom_attributes?: Array<{ attribute_code: string; value: unknown }>;
}

export const tokenRoute: MockRoute = { method: "POST", url: "/rest/V1/integration/admin/token", body: "test-token" };

const filterValue = (url: string, i = 0) =>
  new URL(url).searchParams.get(`searchCriteria[filterGroups][${i}][filters][0][value]`) ?? "";

export function catalogRoutes(
  products: RawFixtureProduct[],
  children: Record<string, RawFixtureProduct[]> = {},
): MockRoute[] {
  return [
    tokenRoute,
    {
      method: "GET",
      url: /\/rest\/V1\/configurable-products\/[^/]+\/children/,
      body: (req: MockRequest) => {
        const sku = decodeURIComponent(req.url.match(/configurable-products\/([^/]+)\/children/)![1]);
        return children[sku] ?? [];
      },
    },
    {
      method: "GET",
      url: "/rest/V1/products?",
      body: (req: MockRequest) => {
        const value = filterValue(req.url);
        const items = value.startsWith("%")
          ? products.filter((p) => p.sku.toUpperCase().includes(value.replace(/%/g, "").toUpperCase()))
          : products.filter((p) => value.toUpperCase().split(",").includes(p.sku.toUpperCase()));
        return { items, total_count: items.length };
      },
    },
  ];
}
