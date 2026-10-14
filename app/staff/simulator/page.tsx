import { getPoAgentConfig } from "@/lib/po-agent/config";
import { effectiveEnv } from "@/lib/po-agent/effective-env";
import { activeStoreSource, sessionStoreHash } from "@/lib/bc-app/request-context";
import { hasConfiguredModel } from "@/lib/po-agent/ai/registry";
import { Simulator } from "@/components/simulator";
import { ConversationSimulator } from "@/components/conversation-simulator";
import { SimulatorTabs } from "@/components/simulator-tabs";
import { PageHead } from "../ui";

export const dynamic = "force-dynamic";

export default async function SimulatorPage() {
  const hash = await sessionStoreHash();
  const env = await effectiveEnv(hash ?? undefined);
  const config = getPoAgentConfig(env);
  const { storeHash } = await activeStoreSource();

  return (
    <>
      <PageHead
        title="Simulator"
        sub="Write as a customer and watch the agent decide and reply. Nothing here is emailed."
      />
      <SimulatorTabs
        conversation={<ConversationSimulator storeHash={storeHash} modelConfigured={hasConfiguredModel(env)} />}
        pipeline={
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            <span style={{ fontSize: "var(--text-caption-size)", color: "var(--text-metadata)" }}>
              {config.simulatorSend
                ? "The decision logic real email uses today. Sandbox mode is ON — runs submit for real."
                : "The decision logic real email uses today. Dry run — no email sent, nothing submitted."}
            </span>
            <Simulator defaultFrom="t.nguyen@pacific-elec.com" sandbox={config.simulatorSend} sandboxEmails={config.simulatorSendEmails} />
          </div>
        }
      />
    </>
  );
}
