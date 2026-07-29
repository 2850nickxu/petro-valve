"use client";

import type { ReactNode } from "react";
import { ToastProvider } from "./toast";
import { ConfirmProvider } from "./confirm";

/** App-wide client UI providers (toasts + confirm dialog). Mounted in the root layout so
 * both the staff console and the public demo can use them. Server-rendered children pass
 * straight through. */
export function UiProviders({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <ConfirmProvider>{children}</ConfirmProvider>
    </ToastProvider>
  );
}
