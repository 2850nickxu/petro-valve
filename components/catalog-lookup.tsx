"use client";

import { useState, type CSSProperties } from "react";
import { Badge, Button, DataTable, Panel, TextareaField, type Column } from "@/components/backbone";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm";
import { Banner, EmptyState } from "@/components/ui/states";
import { formatMoney } from "@/components/ui/money";
import { parseLookupLine, type LookupRow } from "@/lib/magento/lookup";

// Catalog lookup against the connected Magento store: paste part numbers the way a customer
// writes them and see what the agent would match — exact, a recommendation to confirm, a
// parent that needs a size, several brands, or nothing — with the web price. Matched lines
// can be put in a guest cart (the store's only write), when guest-cart writes are on.

interface CartResult {
  maskedId: string;
  items: Array<{ itemId: number; sku: string; name: string; qty: number; price: number }>;
  totals: { subtotal: number; grandTotal: number; currency: string; items: Array<{ itemId: number; rowTotal: number }> };
  priceMismatches: Array<{ sku: string; catalogPrice: number; cartPrice: number }>;
  excludedItems: Array<{ sku: string; qty: number }>;
  link: string | null;
}

interface CartLineRow {
  key: string;
  sku: string;
  qty: number;
  price: number;
  rowTotal: number;
  charged: boolean;
  catalogPrice?: number;
}

const CART_COLUMNS: Column[] = [
  { key: "sku", label: "SKU", mono: true },
  { key: "qty", label: "Qty", numeric: true, align: "right" },
  {
    key: "catalogPrice",
    label: "Catalog price",
    numeric: true,
    align: "right",
    render: (r: CartLineRow) => (r.catalogPrice != null ? formatMoney(r.catalogPrice) : "—"),
  },
  { key: "price", label: "Cart price", numeric: true, align: "right", render: (r: CartLineRow) => formatMoney(r.price) },
  { key: "rowTotal", label: "Row total", numeric: true, align: "right", render: (r: CartLineRow) => formatMoney(r.rowTotal) },
  {
    key: "charged",
    label: "Checkout",
    render: (r: CartLineRow) => (r.charged ? <Badge tone="neutral">Charged</Badge> : <Badge tone="danger">Not charged</Badge>),
  },
];

const caption: CSSProperties = { fontSize: "var(--text-caption-size)", color: "var(--text-metadata)" };
const EXAMPLE = "VO 12111-1, 2\nvo 12111 1 1/2\" x 1\n12111-1\nVO 12111-3\n12111";

function cartRows(cart: CartResult): CartLineRow[] {
  const rowTotal = new Map(cart.totals.items.map((t) => [t.itemId, t.rowTotal]));
  const catalog = new Map(cart.priceMismatches.map((m) => [m.sku, m.catalogPrice]));
  return cart.items.map((i) => ({
    key: String(i.itemId),
    sku: i.sku,
    qty: i.qty,
    price: i.price,
    rowTotal: rowTotal.get(i.itemId) ?? 0,
    charged: (rowTotal.get(i.itemId) ?? 0) > 0,
    catalogPrice: catalog.get(i.sku) ?? i.price,
  }));
}

function resultBadge(r: LookupRow) {
  if (r.status === "unresolved") return <Badge tone="danger">Not found</Badge>;
  if (r.status === "ambiguous") return <Badge tone="warning">Several brands</Badge>;
  if (r.status === "parent") return <Badge tone="warning">Size needed</Badge>;
  if (r.enabled === false) return <Badge tone="danger">Disabled</Badge>;
  if (r.priceAnomaly) return <Badge tone="danger">Placeholder price</Badge>;
  if (r.exact === false) return <Badge tone="warning">Recommendation</Badge>;
  return <Badge tone="neutral">Exact</Badge>;
}

function note(r: LookupRow): string {
  switch (r.status) {
    case "unresolved":
      return "No product with this part number. The agent escalates it (P2).";
    case "ambiguous":
      return `Carried by ${r.candidates!.map((c) => c.sku).join(", ")}. The agent asks which one (P5).`;
    case "parent": {
      const placeholders = r.children!.filter((c) => c.priceAnomaly).length;
      return `${r.childCount} sizes${placeholders ? `, ${placeholders} at a placeholder price` : ""}. The agent escalates for the size (P14).`;
    }
    default:
      if (r.enabled === false) return "Disabled in Magento. The agent escalates it (P10).";
      if (r.priceAnomaly) return "Priced at $0.01, a placeholder. The agent escalates it (Q5).";
      if (r.exact === false) return "We added the brand prefix. The agent asks the customer to confirm (P4), so it stays out of the cart.";
      return r.qty == null ? "No quantity given; the agent asks for one (Q8), so it stays out of the cart." : "Quotable.";
  }
}

const COLUMNS: Column[] = [
  { key: "input", label: "Requested", mono: true, wrap: true },
  { key: "result", label: "Result", render: (r: LookupRow) => resultBadge(r) },
  { key: "sku", label: "Matched SKU", mono: true, render: (r: LookupRow) => r.sku ?? "—" },
  { key: "name", label: "Product", wrap: true, muted: true, render: (r: LookupRow) => r.name ?? "—" },
  { key: "qty", label: "Qty", numeric: true, align: "right", render: (r: LookupRow) => r.qty ?? "—" },
  {
    key: "price",
    label: "Web price",
    numeric: true,
    align: "right",
    render: (r: LookupRow) => (r.status === "matched" && r.price != null && !r.priceAnomaly ? formatMoney(r.price) : "—"),
  },
  { key: "note", label: "What the agent does", wrap: true, render: (r: LookupRow) => note(r) },
];

export function CatalogLookup({
  storeUrl,
  store,
  guestCartWrites,
  cartLinks,
}: {
  storeUrl: string;
  /** Which Magento store is active (MAGENTO_STORE). */
  store: "production" | "sandbox";
  guestCartWrites: boolean;
  cartLinks: boolean;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [text, setText] = useState(EXAMPLE);
  const [rows, setRows] = useState<LookupRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cart, setCart] = useState<CartResult | null>(null);

  const cartable = (rows ?? []).filter((r) => r.cartable);
  const blocked = (rows ?? []).length - cartable.length;

  async function lookUp() {
    const lines = text.split(/\r?\n/).map(parseLookupLine).filter((l): l is NonNullable<typeof l> => Boolean(l));
    setLoading(true);
    setError(null);
    setCart(null);
    try {
      const res = await fetch("/api/staff/catalog/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines }),
      });
      const json = (await res.json()) as { rows?: LookupRow[]; error?: string };
      if (!res.ok || !json.rows) throw new Error(json.error ?? "Lookup failed.");
      setRows(json.rows);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Lookup failed.";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  async function buildCart() {
    const lines = cartable.map((r) => ({ sku: r.sku!, qty: r.qty ?? 1 }));
    const ok = await confirm({
      title: store === "production" ? "Create a guest cart on the PRODUCTION store?" : "Create a guest cart on the sandbox?",
      body: `This creates a real guest cart on ${storeUrl} (${store}) with ${lines.length} item${lines.length === 1 ? "" : "s"}. No email or customer is set on it, and it can't be deleted from here; Magento cleans up unused carts on its own.`,
      confirmLabel: "Create guest cart",
    });
    if (!ok) return;
    setBuilding(true);
    setError(null);
    try {
      const res = await fetch("/api/staff/catalog/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines }),
      });
      const json = (await res.json()) as CartResult & { error?: string; problems?: Array<{ sku: string; reason: string }> };
      if (!res.ok) {
        const detail = json.problems?.length ? ` ${json.problems.map((p) => `${p.sku}: ${p.reason}`).join("; ")}.` : "";
        throw new Error(`${json.error ?? "Couldn't build the cart."}${detail}`);
      }
      setCart(json);
      toast.success("Guest cart created.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't build the cart.";
      setError(msg);
      toast.error(msg);
    } finally {
      setBuilding(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--gap-group)" }}>
      <Panel
        title="Part numbers"
        meta={`Matched against ${storeUrl} — read-only`}
        actions={<Badge tone={store === "sandbox" ? "info" : "neutral"}>{store === "sandbox" ? "Sandbox" : "Production"}</Badge>}
        bodyStyle={{ gap: "var(--gap-group)" }}
      >
        <TextareaField
          label="One per line, as a customer would write it"
          help={'Add a quantity after a comma, a tab or an "x": VO 12111-1, 2'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
        />
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <Button variant="primary" icon="search" onClick={lookUp} loading={loading} disabled={!text.trim()}>
            Look up
          </Button>
          <span style={caption}>Uses the same matching as the agent: brand prefixes, spacing, inch marks and fractions.</span>
        </div>
        {error ? <span style={{ color: "var(--danger-600)" }}>{error}</span> : null}
      </Panel>

      {rows ? (
        <Panel
          title="What the agent would match"
          meta={`${cartable.length} of ${rows.length} line${rows.length === 1 ? "" : "s"} can go in a cart`}
          padded={false}
          actions={
            guestCartWrites ? (
              <Button variant="secondary" onClick={buildCart} loading={building} disabled={!cartable.length}>
                Create guest cart
              </Button>
            ) : (
              <Badge tone="neutral">Read-only</Badge>
            )
          }
        >
          <div data-density="compact">
            <DataTable
              columns={COLUMNS}
              rows={rows.map((r, i) => ({ ...r, key: `${i}` }))}
              rowKey="key"
              minWidth={860}
              caption="Lookup results"
              emptyState={<EmptyState title="Nothing to show">Enter part numbers above.</EmptyState>}
            />
          </div>
          {!guestCartWrites || blocked ? (
            <div style={{ padding: "var(--panel-pad)", ...caption }}>
              {!guestCartWrites
                ? `Guest-cart writes are off for the ${store} store, so carts can't be created. Turn them on in Settings → Store.`
                : `${blocked} line${blocked === 1 ? "" : "s"} can't go in a cart and will be left out.`}
            </div>
          ) : null}
        </Panel>
      ) : null}

      {cart ? (
        <Panel title="Guest cart" meta={`Cart ${cart.maskedId} · no email or customer on it`} bodyStyle={{ gap: "var(--gap-group)" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-6)" }}>
            <span>
              <span style={caption}>Items</span>
              <br />
              {cart.items.reduce((n, i) => n + i.qty, 0)}
            </span>
            <span>
              <span style={caption}>Subtotal</span>
              <br />
              {formatMoney(cart.totals.subtotal, cart.totals.currency)}
            </span>
            <span>
              <span style={caption}>Grand total</span>
              <br />
              {formatMoney(cart.totals.grandTotal, cart.totals.currency)}
            </span>
          </div>
          <div data-density="compact">
            <DataTable columns={CART_COLUMNS} rows={cartRows(cart)} rowKey="key" minWidth={620} caption="Cart lines" />
          </div>
          {cart.excludedItems.length ? (
            <Banner kind="error" title="Magento left some lines out of the totals">
              {cart.excludedItems.map((i) => i.sku).join(", ")} {cart.excludedItems.length === 1 ? "is" : "are"} in the cart but not
              charged: the store won&rsquo;t sell {cart.excludedItems.length === 1 ? "it" : "them"} right now (stock or availability).
              The agent never sends a cart like this; it hands the request to a person.
            </Banner>
          ) : null}
          {cart.priceMismatches.length ? (
            <Banner kind="warn" title="Magento priced some lines differently from the catalog">
              {cart.priceMismatches.map((m) => `${m.sku}: catalog ${formatMoney(m.catalogPrice)}, cart ${formatMoney(m.cartPrice)}`).join(" · ")}.
              The store reprices items when they go in a cart. Until we decide which price a quote uses, the agent hands
              these to a person instead of quoting.
            </Banner>
          ) : null}
          {cart.link ? (
            <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={caption}>Signed cart link (opens once the Silk Magento module is deployed)</span>
              <code style={{ overflowWrap: "anywhere", fontSize: "var(--text-caption-size)" }}>{cart.link}</code>
            </span>
          ) : (
            <span style={caption}>
              {cartLinks ? "No link was returned." : "No cart link: set the cart link secret in Settings → Store to sign links."}
            </span>
          )}
        </Panel>
      ) : null}
    </div>
  );
}
