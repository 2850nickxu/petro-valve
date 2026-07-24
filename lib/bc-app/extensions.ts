import type { StoreContext } from "@/lib/bc/store-context";

// Register App Extensions (control-panel PANEL menu items on Orders + Customers) via the
// GraphQL Admin API. MUST use the app-level OAuth token (store-level tokens can't manage
// extensions) with the store_app_extensions_manage scope — so this runs on /auth (install).
// Idempotent: queries existing extensions and only creates the missing ones.

interface DesiredExtension {
  context: "PANEL" | "LINK";
  model: "ORDERS" | "CUSTOMERS" | "PRODUCTS";
  url: string; // ${id} is substituted by BigCommerce at click time
  label: string;
}

// NB: ${id} is a literal placeholder here (single-quoted), not a JS template.
export const DESIRED_EXTENSIONS: DesiredExtension[] = [
  { context: "PANEL", model: "ORDERS", url: "/api/bc-app/ext/orders/${id}", label: "PO Agent" },
  { context: "PANEL", model: "CUSTOMERS", url: "/api/bc-app/ext/customers/${id}", label: "PO Agent" },
];

const CREATE_MUTATION = `
mutation AppExtension($input: CreateAppExtensionInput!) {
  appExtension { createAppExtension(input: $input) { appExtension { id model url } } }
}`;

const LIST_QUERY = `
query { store { appExtensions { edges { node { id url model context } } } } }`;

interface ExtNode {
  id: string;
  url: string;
  model: string;
  context: string;
}

async function graphqlAdmin<T>(ctx: StoreContext, query: string, variables?: object): Promise<T> {
  const res = await fetch(`https://api.bigcommerce.com/stores/${ctx.storeHash}/graphql`, {
    method: "POST",
    headers: {
      "X-Auth-Token": ctx.accessToken.replace(/\s+/g, ""),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  const json = (await res.json()) as { data?: T; errors?: unknown };
  if (!res.ok || json.errors) {
    throw new Error(`App Extensions GraphQL error: ${JSON.stringify(json.errors ?? res.status).slice(0, 200)}`);
  }
  return json.data as T;
}

export async function listAppExtensions(ctx: StoreContext): Promise<ExtNode[]> {
  const data = await graphqlAdmin<{ store: { appExtensions: { edges: Array<{ node: ExtNode }> } } }>(ctx, LIST_QUERY);
  return data.store.appExtensions.edges.map((e) => e.node);
}

export async function registerAppExtensions(
  ctx: StoreContext,
): Promise<{ created: string[]; existing: string[]; error?: string }> {
  try {
    const existing = await listAppExtensions(ctx).catch(() => [] as ExtNode[]);
    const created: string[] = [];
    const kept: string[] = [];
    for (const ext of DESIRED_EXTENSIONS) {
      const match = existing.find((e) => e.model === ext.model && e.url === ext.url);
      if (match) {
        kept.push(match.id);
        continue;
      }
      const data = await graphqlAdmin<{ appExtension: { createAppExtension: { appExtension: { id: string } } } }>(
        ctx,
        CREATE_MUTATION,
        { input: { context: ext.context, model: ext.model, url: ext.url, label: { defaultValue: ext.label, locales: [] } } },
      );
      created.push(data.appExtension.createAppExtension.appExtension.id);
    }
    return { created, existing: kept };
  } catch (e) {
    return { created: [], existing: [], error: e instanceof Error ? e.message : String(e) };
  }
}
