import { cookies } from "next/headers";
import { SETTINGS_FIELDS, settingsView, type SettingsScope } from "@/lib/po-agent/settings-store";
import { verifiedStoreHash } from "@/lib/bc-app/resolve-context";
import { listStoreInstalls } from "@/lib/bc-app/store-tokens";
import { SettingsForm } from "@/components/settings-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const hash = verifiedStoreHash((await cookies()).get("poa_app")?.value);
  const scope: SettingsScope = hash ? `store:${hash}` : "global";
  const [view, installs] = await Promise.all([settingsView(scope), listStoreInstalls()]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="muted">
            Configure the agent here — no env/CLI needed. Saved to{" "}
            <span className="tag">{scope === "global" ? "this deployment" : `store ${hash}`}</span>. Secrets are encrypted at rest 🔒.
          </p>
        </div>
      </div>

      <SettingsForm fields={SETTINGS_FIELDS} view={view} />

      <div className="card" style={{ marginTop: 8 }}>
        <h3>Installed stores (app)</h3>
        {installs.length ? (
          <table className="table">
            <thead><tr><th>Store hash</th><th>Owner</th><th>Installed</th><th>Token</th></tr></thead>
            <tbody>
              {installs.map((i) => (
                <tr key={i.storeHash}>
                  <td className="mono">{i.storeHash}</td>
                  <td className="muted">{i.ownerEmail ?? "—"}</td>
                  <td className="muted mono">{i.installedAt.slice(0, 16).replace("T", " ")}</td>
                  <td><span className="tag">OAuth (per-store)</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No app installs yet — the agent uses the deployment (env/global) settings.</p>
        )}
      </div>
    </>
  );
}
