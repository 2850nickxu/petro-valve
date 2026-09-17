import { getRedis } from "@/lib/redis";
import { SessionsBrowser } from "@/components/sessions-browser";
import { PageHead } from "../ui";
import { Banner } from "@/components/ui/states";

export const dynamic = "force-dynamic";

export default function SessionsPage() {
  const redis = getRedis();

  return (
    <>
      <PageHead title="Sessions" sub="Search and review every processed PO — one session per email thread" />

      {!redis && (
        <Banner kind="warn" title="Redis not configured">
          Session search is unavailable until Redis credentials are added.
        </Banner>
      )}

      <SessionsBrowser />
    </>
  );
}
