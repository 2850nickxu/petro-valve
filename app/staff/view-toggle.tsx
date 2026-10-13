"use client";

import { SegmentedControl } from "@/components/backbone";
import { VIEW_HOME, VIEW_LABEL, type AdminView } from "@/lib/po-agent/admin-view";

/** Switch between the Silk and customer admin views. A full page load, not a client-side
 * transition, so the shell (menu, header status) re-renders for the new view. */
export function ViewToggle({ view }: { view: AdminView }) {
  return (
    <SegmentedControl
      label="Admin view"
      value={view}
      onChange={(v) => {
        if (v !== view) window.location.assign(VIEW_HOME[v as AdminView]);
      }}
      options={(["silk", "customer"] as const).map((v) => ({ value: v, label: VIEW_LABEL[v] }))}
    />
  );
}
