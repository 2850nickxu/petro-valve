// Route-based mock for global fetch. Stubs the entire BigCommerce/B2B surface so the
// lib/bc layer is unit-testable with no network. First matching route wins.

export interface MockRequest {
  url: string;
  method: string;
  body: unknown;
  headers: Record<string, string>;
}

function normalizeHeaders(h: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h) return out;
  if (h instanceof Headers) {
    h.forEach((v, k) => (out[k.toLowerCase()] = v));
  } else if (Array.isArray(h)) {
    for (const [k, v] of h) out[k.toLowerCase()] = v;
  } else {
    for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = String(v);
  }
  return out;
}

export interface MockRoute {
  /** HTTP method to match (default: any). */
  method?: string;
  /** Substring (string) or pattern (RegExp) matched against the request URL. */
  url: string | RegExp;
  /** HTTP status to return (default 200). */
  status?: number;
  /** Response body, or a factory computed from the request. */
  body: unknown | ((req: MockRequest) => unknown);
}

export interface MockFetchController {
  fetch: typeof fetch;
  calls: MockRequest[];
  /** Calls whose URL includes the given substring. */
  callsTo(substr: string): MockRequest[];
}

export function createMockFetch(routes: MockRoute[]): MockFetchController {
  const calls: MockRequest[] = [];

  const impl = async (input: unknown, init: RequestInit = {}): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : (input as { url?: string })?.url ?? String(input);
    const method = (init.method ?? "GET").toUpperCase();
    let body: unknown;
    if (init.body != null) {
      try {
        body = JSON.parse(String(init.body));
      } catch {
        body = init.body;
      }
    }
    const req: MockRequest = { url, method, body, headers: normalizeHeaders(init.headers) };
    calls.push(req);

    const route = routes.find((r) => {
      const methodOk = !r.method || r.method.toUpperCase() === method;
      const urlOk = typeof r.url === "string" ? url.includes(r.url) : r.url.test(url);
      return methodOk && urlOk;
    });
    if (!route) {
      throw new Error(`mock-fetch: no route matched ${method} ${url}`);
    }

    const status = route.status ?? 200;
    const payload = typeof route.body === "function" ? (route.body as (r: MockRequest) => unknown)(req) : route.body;

    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload,
      text: async () => (typeof payload === "string" ? payload : JSON.stringify(payload)),
    } as Response;
  };

  return {
    fetch: impl as unknown as typeof fetch,
    calls,
    callsTo(substr: string) {
      return calls.filter((c) => c.url.includes(substr));
    },
  };
}

/** Install the mock as the global fetch and return the controller. */
export function installMockFetch(routes: MockRoute[]): MockFetchController {
  const controller = createMockFetch(routes);
  globalThis.fetch = controller.fetch;
  return controller;
}

/** A throwaway StoreContext for tests. */
export const TEST_CTX = {
  storeHash: "teststore",
  accessToken: "test-token",
  channelId: 1,
};
