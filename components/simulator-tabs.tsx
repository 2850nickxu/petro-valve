"use client";

import { useState, type ReactNode } from "react";
import { TabPanel, Tabs } from "@/components/backbone";

// The Simulator's two modes: the rules-driven conversation (default) and the current
// pipeline's one-shot run. Both panels are rendered by the server page and passed in. The
// one-shot pipeline is BigCommerce B2B only, so a Magento deployment shows the conversation alone.

type TabId = "conversation" | "pipeline";

export function SimulatorTabs({ conversation, pipeline }: { conversation: ReactNode; pipeline?: ReactNode }) {
  const [tab, setTab] = useState<TabId>("conversation");
  if (!pipeline) return <>{conversation}</>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--gap-group)" }}>
      <Tabs
        label="Simulator mode"
        idPrefix="simulator"
        tabs={[
          { value: "conversation", label: "Conversation · Petro Valve rules (draft)" },
          { value: "pipeline", label: "Current pipeline" },
        ]}
        value={tab}
        onChange={(v) => setTab(v as TabId)}
      />
      <TabPanel value="conversation" activeValue={tab} idPrefix="simulator">
        {conversation}
      </TabPanel>
      <TabPanel value="pipeline" activeValue={tab} idPrefix="simulator">
        {pipeline}
      </TabPanel>
    </div>
  );
}
