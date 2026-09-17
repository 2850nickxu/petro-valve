"use client";

// Lightweight toast notifications on Backbone's Toast + ToastStack. Provider mounts once
// (root layout); any client component calls useToast() for success/error/info feedback.
// The stack, ids and auto-dismiss timers live here — the Backbone components are
// presentational.

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { Toast, ToastStack } from "@/components/backbone";

type ToastKind = "ok" | "error" | "info";
interface ToastApi {
  show: (message: string, kind?: ToastKind) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const TONE: Record<ToastKind, "success" | "danger" | "info"> = { ok: "success", error: "danger", info: "info" };

interface ToastEntry {
  id: number;
  tone: "success" | "danger" | "info";
  title: string;
}

const ToastCtx = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const api = useMemo<ToastApi>(() => {
    const show = (message: string, kind: ToastKind = "info") => {
      const id = nextId.current++;
      setToasts((list) => [...list, { id, tone: TONE[kind], title: message }]);
      setTimeout(() => dismiss(id), 4500);
    };
    return {
      show,
      success: (m) => show(m, "ok"),
      error: (m) => show(m, "error"),
      info: (m) => show(m, "info"),
    };
  }, [dismiss]);

  return (
    <ToastCtx.Provider value={api}>
      {children}
      {toasts.length > 0 ? (
        <ToastStack>
          {toasts.map((t) => (
            <Toast key={t.id} tone={t.tone} title={t.title} onDismiss={() => dismiss(t.id)} />
          ))}
        </ToastStack>
      ) : null}
    </ToastCtx.Provider>
  );
}
