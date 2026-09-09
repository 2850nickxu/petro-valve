"use client";

// Lightweight toast notifications, backed by Big Design's alerts manager. Provider mounts
// once (root layout); any client component calls useToast() for success/error/info feedback
// that replaces the old ephemeral inline "msg" strings.

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { AlertsManager, createAlertsManager } from "@bigcommerce/big-design";

type ToastKind = "ok" | "error" | "info";
interface ToastApi {
  show: (message: string, kind?: ToastKind) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}
const TYPE: Record<ToastKind, "success" | "error" | "info"> = { ok: "success", error: "error", info: "info" };
const ToastCtx = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [manager] = useState(() => createAlertsManager());
  const api = useMemo<ToastApi>(() => {
    const show = (message: string, kind: ToastKind = "info") =>
      manager.add({ type: TYPE[kind], messages: [{ text: message }], autoDismiss: true });
    return { show, success: (m) => show(m, "ok"), error: (m) => show(m, "error"), info: (m) => show(m, "info") };
  }, [manager]);

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <AlertsManager manager={manager} />
    </ToastCtx.Provider>
  );
}
