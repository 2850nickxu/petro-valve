"use client";

// Lightweight toast notifications. Provider mounts once (root layout); any client
// component calls useToast() for success/error/info feedback that replaces the old
// ephemeral inline "msg" strings.

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

type ToastKind = "ok" | "error" | "info";
interface ToastItem { id: number; kind: ToastKind; message: string }

interface ToastApi {
  show: (message: string, kind?: ToastKind) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastCtx = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const remove = useCallback((id: number) => {
    setItems((xs) => xs.filter((x) => x.id !== id));
  }, []);

  const show = useCallback((message: string, kind: ToastKind = "info") => {
    const id = ++seq;
    setItems((xs) => [...xs, { id, kind, message }]);
    setTimeout(() => remove(id), 5000);
  }, [remove]);

  const api = useMemo<ToastApi>(() => ({
    show,
    success: (m) => show(m, "ok"),
    error: (m) => show(m, "error"),
    info: (m) => show(m, "info"),
  }), [show]);

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="toast-host" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <span className="toast-dot" />
            <span>{t.message}</span>
            <button className="toast-close" aria-label="Dismiss" onClick={() => remove(t.id)}>×</button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
