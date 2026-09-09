import { H2, Panel, Small, Text } from "@bigcommerce/big-design";
import { getRedis } from "@/lib/redis";
import { createPoStore } from "@/lib/po-agent/store";
import { Chip, stateLabel } from "@/app/staff/ui";
import type { PoSession } from "@/lib/po-agent/types";

export const dynamic = "force-dynamic";

export default async function CustomerPanel({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const customerId = Number(id);

  let matches: PoSession[] = [];
  const redis = getRedis();
  if (redis) {
    const store = createPoStore(redis);
    const ids = await store.listQueue("recent", 300);
    const sessions = await store.loadSessions(ids);
    matches = sessions.filter((s) => s.buyer?.customerId === customerId);
  }

  return (
    <div>
      <H2 marginBottom="none">PO Agent</H2>
      <Small color="secondary60">Customer #{id}</Small>

      {matches.length ? (
        <>
          <Text color="secondary60" marginTop="medium">
            {matches.length} PO session{matches.length === 1 ? "" : "s"} from this customer.
          </Text>
          {matches.slice(0, 15).map((s) => (
            <Panel key={s.id} marginTop="medium">
              <Text marginBottom="xxSmall">
                <Chip kind={s.state}>{stateLabel(s.state)}</Chip> · PO{" "}
                <Text as="span" style={{ fontVariantNumeric: "tabular-nums" }}>
                  {s.extracted?.poNumber ?? "—"}
                </Text>
                {s.result?.orderId
                  ? ` · order ${s.result.orderId}`
                  : s.result?.quoteId
                    ? ` · quote ${s.result.quoteNumber ?? s.result.quoteId}`
                    : ""}
              </Text>
              <Text marginBottom="none">
                <a href={`/staff/po-inbox/${encodeURIComponent(s.id)}`} target="_blank" rel="noreferrer">
                  Open ↗
                </a>
              </Text>
            </Panel>
          ))}
        </>
      ) : (
        <Text color="secondary60" marginTop="medium">
          No PO Agent email activity from this customer yet.
        </Text>
      )}
    </div>
  );
}
