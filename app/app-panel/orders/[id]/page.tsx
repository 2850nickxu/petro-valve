import { H2, Panel, Small, Text } from "@bigcommerce/big-design";
import { getRedis } from "@/lib/redis";
import { createPoStore } from "@/lib/po-agent/store";
import { Chip, stateLabel } from "@/app/staff/ui";
import type { PoSession } from "@/lib/po-agent/types";

export const dynamic = "force-dynamic";

export default async function OrderPanel({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orderId = Number(id);

  let matches: PoSession[] = [];
  const redis = getRedis();
  if (redis) {
    const store = createPoStore(redis);
    const ids = await store.listQueue("recent", 300);
    const sessions = await store.loadSessions(ids);
    matches = sessions.filter((s) => s.result?.orderId === orderId);
  }

  return (
    <div>
      <H2 marginBottom="none">PO Agent</H2>
      <Small color="secondary60">Order #{id}</Small>

      {matches.length ? (
        matches.map((s) => (
          <Panel key={s.id} marginTop="medium">
            <Text marginBottom="xxSmall">
              <Chip kind={s.state}>{stateLabel(s.state)}</Chip> · PO{" "}
              <Text as="span" bold style={{ fontVariantNumeric: "tabular-nums" }}>
                {s.extracted?.poNumber ?? "—"}
              </Text>
            </Text>
            <Text color="secondary60" marginBottom="xxSmall">
              {s.buyer?.companyName} · {s.buyer?.email}
            </Text>
            <Text marginBottom="none">
              <a href={`/staff/po-inbox/${encodeURIComponent(s.id)}`} target="_blank" rel="noreferrer">
                Open session ↗
              </a>
            </Text>
          </Panel>
        ))
      ) : (
        <Text color="secondary60" marginTop="medium">
          This order wasn’t placed by the PO Agent (no matching email session).
        </Text>
      )}
    </div>
  );
}
