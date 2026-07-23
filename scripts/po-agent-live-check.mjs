#!/usr/bin/env node
// Read-only [L1] sandbox verification. Confirms the store token works, B2B Edition is
// enabled, and probes the shapes the agent depends on (company, user channelList, payment
// code, pricing). No writes. Usage:
//   BIGCOMMERCE_STORE_HASH=… BIGCOMMERCE_ACCESS_TOKEN=… node scripts/po-agent-live-check.mjs

const HASH = process.env.BIGCOMMERCE_STORE_HASH;
const TOKEN = (process.env.BIGCOMMERCE_ACCESS_TOKEN ?? "").trim();
const CHANNEL = Number(process.env.BIGCOMMERCE_CHANNEL_ID ?? "1");
if (!HASH || !TOKEN) {
  console.error("Set BIGCOMMERCE_STORE_HASH and BIGCOMMERCE_ACCESS_TOKEN.");
  process.exit(1);
}

const H = { "X-Auth-Token": TOKEN, "Content-Type": "application/json", Accept: "application/json" };
// B2B Management API additionally requires X-Store-Hash.
const B2B_H = { ...H, "X-Store-Hash": HASH };
const core = (p) => `https://api.bigcommerce.com/stores/${HASH}${p}`;
const b2b = (p) => `https://api-b2b.bigcommerce.com/api/v3/io${p}`;
const isB2b = (url) => url.includes("api-b2b.bigcommerce.com");

async function req(method, url, body) {
  try {
    const r = await fetch(url, { method, headers: isB2b(url) ? B2B_H : H, ...(body ? { body: JSON.stringify(body) } : {}) });
    const text = await r.text();
    let json;
    try { json = JSON.parse(text); } catch { json = text; }
    return { status: r.status, ok: r.ok, json };
  } catch (e) {
    return { status: 0, ok: false, json: String(e) };
  }
}
const get = (url) => req("GET", url);
const post = (url, body) => req("POST", url, body);
const line = (s) => console.log(s);
const show = (label, res, pick) => line(`${res.ok ? "✓" : "✗"} ${label} [${res.status}] ${pick ? pick(res.json) : ""}`);

(async () => {
  line(`\n=== Core BigCommerce (store ${HASH}) ===`);
  const summary = await get(core("/v3/catalog/summary"));
  show("catalog/summary", summary, (j) => `products=${j?.data?.inventory_count ?? "?"}`);

  const channels = await get(core("/v3/channels?available=true"));
  show("channels", channels, (j) => (j?.data ?? []).map((c) => `${c.id}:${c.name}(${c.platform})`).join(", "));

  const prod = await get(core("/v3/catalog/products?limit=1&include=variants"));
  const p0 = prod?.json?.data?.[0];
  show("catalog/products", prod, () => (p0 ? `id=${p0.id} sku=${p0.sku} price=${p0.price} variant=${p0.variants?.[0]?.id}` : "none"));

  line(`\n=== B2B Edition ===`);
  const companies = await get(b2b("/companies?limit=5"));
  show("companies", companies, (j) => (Array.isArray(j?.data) ? j.data : j?.data?.list ?? []).map((c) => `${c.companyId}:${c.companyName}(status=${c.companyStatus})`).join(" | "));
  const firstCompany = (Array.isArray(companies?.json?.data) ? companies.json.data : companies?.json?.data?.list ?? [])[0];

  const users = await get(b2b("/users?limit=5&isIncludeExtraFields=1"));
  const uList = Array.isArray(users?.json?.data) ? users.json.data : users?.json?.data?.list ?? [];
  show("users", users, () => `count=${uList.length}`);
  if (uList[0]) {
    const u = uList[0];
    line(`   sample user: email=${u.email} role=${JSON.stringify(u.role)} companyId=${u.companyId} channelList=${JSON.stringify(u.channelList)}`);
  }

  const payments = await get(b2b("/payments"));
  show("store payments (codes)", payments, (j) => {
    const arr = Array.isArray(j?.data) ? j.data : j?.data?.list ?? [];
    return arr.map((m) => `${m.code}${m.isEnabled === false ? "(off)" : ""}`).join(", ");
  });

  if (firstCompany) {
    const cid = firstCompany.companyId;
    line(`\n=== Company ${cid} (${firstCompany.companyName}) ===`);
    const company = await get(b2b(`/companies/${cid}`));
    show("company detail", company, (j) => `bcGroupId=${j?.data?.bcGroupId} priceListAssign=${JSON.stringify(j?.data?.priceListAssign ?? [])}`);
    const cpay = await get(b2b(`/companies/${cid}/payments`));
    show("company payments", cpay, (j) => {
      const arr = Array.isArray(j?.data) ? j.data : j?.data?.list ?? [];
      return arr.map((m) => `${m.code}=${m.isEnabled}`).join(", ");
    });
    const credit = await get(b2b(`/companies/${cid}/credit`));
    show("company credit", credit, (j) => JSON.stringify(j?.data ?? j));

    // Pricing round-trip using this company's group + a real product.
    if (p0) {
      const groupId = company?.json?.data?.bcGroupId ?? 0;
      const pricing = await post(core("/v3/pricing/products"), {
        channel_id: CHANNEL,
        currency_code: "USD",
        customer_group_id: groupId,
        items: [{ product_id: p0.id, variant_id: p0.variants?.[0]?.id }],
      });
      show("pricing/products", pricing, (j) => {
        const it = j?.data?.[0];
        return it ? `calculated=${it.calculated_price?.tax_exclusive ?? it.calculated_price?.as_entered} (as_entered=${it.calculated_price?.as_entered})` : "none";
      });
    }
  }
  line("");
})();
