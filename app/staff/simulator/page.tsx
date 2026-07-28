import { cookies } from "next/headers";
import { getPoAgentConfig } from "@/lib/po-agent/config";
import { effectiveEnv } from "@/lib/po-agent/effective-env";
import { verifiedStoreHash } from "@/lib/bc-app/resolve-context";
import { Simulator } from "@/components/simulator";

export const dynamic = "force-dynamic";

export default async function SimulatorPage() {
  const hash = verifiedStoreHash((await cookies()).get("poa_app")?.value);
  const config = getPoAgentConfig(await effectiveEnv(hash ?? undefined));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Simulator</h1>
          <p className="muted">Inject a PO and watch identify → extract → resolve → price → validate → decide.</p>
        </div>
      </div>
      <Simulator defaultFrom="t.nguyen@pacific-elec.com" sandbox={config.simulatorSend} sandboxEmails={config.simulatorSendEmails} />
    </>
  );
}
