"use client";

import type { ReactNode } from "react";
import { Collapse } from "@bigcommerce/big-design";

/** Collapsible section — for raw JSON dumps and long audit logs that shouldn't dominate
 * the default view. */
export function Disclosure({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  return (
    <Collapse initiallyOpen={defaultOpen}>
      <Collapse.Trigger title={title} />
      <Collapse.Panel marginTop="small">{children}</Collapse.Panel>
    </Collapse>
  );
}
