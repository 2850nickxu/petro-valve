"use client";

import { useState, type ReactNode } from "react";

/** Collapsible section — for raw JSON dumps and long audit logs that shouldn't dominate
 * the default view. */
export function Disclosure({ title, defaultOpen = false, children }: { title: ReactNode; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="disclosure">
      <button type="button" className="disclosure-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className={`disclosure-caret ${open ? "open" : ""}`}>▶</span>
        <span>{title}</span>
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}
