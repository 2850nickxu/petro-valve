"use client";

// Promise-based confirm dialog on Backbone's Modal. useConfirm() returns an async function;
// awaiting it resolves true/false. The Modal implements the overlay contract (role=dialog,
// Escape to dismiss, focus trap and return). A destructive confirm renders the primary
// action as variant="destructive".

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { Button, Modal } from "@/components/backbone";

export interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

type Resolver = (ok: boolean) => void;

const ConfirmCtx = createContext<((o: ConfirmOptions) => Promise<boolean>) | null>(null);

export function useConfirm() {
  const ctx = useContext(ConfirmCtx);
  if (!ctx) throw new Error("useConfirm must be used within <ConfirmProvider>");
  return ctx;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<Resolver | null>(null);

  const confirm = useCallback(
    (o: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        resolver.current = resolve;
        setOpts(o);
      }),
    [],
  );

  const close = useCallback((ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setOpts(null);
  }, []);

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Modal
        open={!!opts}
        title={opts?.title ?? ""}
        onClose={() => close(false)}
        footer={
          opts ? (
            <>
              <Button variant="secondary" onClick={() => close(false)}>
                {opts.cancelLabel ?? "Cancel"}
              </Button>
              <Button variant={opts.danger ? "destructive" : "primary"} onClick={() => close(true)}>
                {opts.confirmLabel ?? "Confirm"}
              </Button>
            </>
          ) : undefined
        }
      >
        {opts?.body}
      </Modal>
    </ConfirmCtx.Provider>
  );
}
