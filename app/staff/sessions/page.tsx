import { getRedis } from "@/lib/redis";
import { SessionsBrowser } from "@/components/sessions-browser";
import { Banner } from "@/components/ui/states";

export const dynamic = "force-dynamic";

export default function SessionsPage() {
  const redis = getRedis();

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Sessions</h1>
          <p className="muted">Search and review every processed PO.</p>
        </div>
      </div>

      {!redis && (
        <Banner kind="warn" title="Redis not configured">
          Session search is unavailable until Redis credentials are added.
        </Banner>
      )}

      <SessionsBrowser />
    </>
  );
}
