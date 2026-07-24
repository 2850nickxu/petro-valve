import { Simulator } from "@/components/simulator";

export const dynamic = "force-dynamic";

export default function SimulatorPage() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Simulator</h1>
          <p className="muted">Inject a PO and watch identify → extract → resolve → price → validate → decide.</p>
        </div>
      </div>
      <Simulator defaultFrom="t.nguyen@pacific-elec.com" />
    </>
  );
}
