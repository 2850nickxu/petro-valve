import Link from "next/link";
import { effectiveEnv } from "@/lib/po-agent/effective-env";
import { adminStatus } from "@/lib/po-agent/admin-status";
import { sessionStoreHash } from "@/lib/bc-app/request-context";
import { Banner } from "@/components/ui/states";
import { CatalogLookup } from "@/components/catalog-lookup";
import { PageHead } from "../ui";

export const dynamic = "force-dynamic";

export default async function CatalogPage() {
  const status = adminStatus(await effectiveEnv((await sessionStoreHash()) ?? undefined));
  const magento = status.commerce.magento;

  return (
    <>
      <PageHead
        title="Catalog"
        sub="Look up part numbers in the Magento store the way the agent does, and build a guest cart from the matches."
      />
      {!magento ? (
        <Banner kind="info" title="Catalog lookup is for Magento stores">
          This deployment quotes from BigCommerce. Switch the commerce platform in <Link href="/staff/settings">Settings → Store</Link>.
        </Banner>
      ) : !magento.configured || !magento.baseUrl ? (
        <Banner kind="warn" title={`The Magento ${magento.store} store isn't connected`}>
          Add its URL and admin login in <Link href="/staff/settings">Settings → Store</Link>.
        </Banner>
      ) : (
        <CatalogLookup
          storeUrl={magento.baseUrl}
          store={magento.store}
          guestCartWrites={magento.guestCartWrites}
          cartLinks={magento.cartLinks}
        />
      )}
    </>
  );
}
