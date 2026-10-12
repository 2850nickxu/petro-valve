import { getPoAgentConfig } from "@/lib/po-agent/config";
import { effectiveEnv } from "@/lib/po-agent/effective-env";
import { sessionStoreHash } from "@/lib/bc-app/request-context";
import { Simulator } from "@/components/simulator";
import { PageHead } from "../ui";

export const dynamic = "force-dynamic";

export default async function SimulatorPage() {
  const hash = await sessionStoreHash();
  const config = getPoAgentConfig(await effectiveEnv(hash ?? undefined));

  return (
    <>
      <PageHead
        title="Simulator"
        sub={
          config.simulatorSend
            ? "Paste a PO and watch the pipeline decide. Sandbox mode is ON — runs submit for real."
            : "Paste a PO and watch the pipeline decide. Dry run — no email sent, nothing submitted."
        }
      />
      <Simulator
        defaultFrom="t.nguyen@pacific-elec.com"
        sandbox={config.simulatorSend}
        sandboxEmails={config.simulatorSendEmails}
      />
    </>
  );
}
