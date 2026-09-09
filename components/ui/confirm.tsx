"use client";

// Promise-based confirm dialog. useConfirm() returns an async function; awaiting it
// resolves true/false. Backed by Big Design's Modal: Esc cancels (closeOnEscKey), backdrop
// click cancels (closeOnClickOutside), and a destructive confirm renders as
// actionType="destructive".

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { Modal, type ModalAction } from "@bigcommerce/big-design";

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

  const confirm = useCallback((o: ConfirmOptions) => new Promise<boolean>((resolve) => {
    resolver.current = resolve;
    setOpts(o);
  }), []);

  const close = useCallback((ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setOpts(null);
  }, []);

  const actions: ModalAction[] | undefined = opts
    ? [
        { text: opts.cancelLabel ?? "Cancel", variant: "secondary", onClick: () => close(false) },
        {
          text: opts.confirmLabel ?? "Confirm",
          variant: "primary",
          actionType: opts.danger ? "destructive" : "normal",
          onClick: () => close(true),
        },
      ]
    : undefined;

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Modal
        isOpen={!!opts}
        onClose={() => close(false)}
        header={opts?.title}
        actions={actions}
        variant="dialog"
        closeOnEscKey
        closeOnClickOutside
      >
        {opts?.body}
      </Modal>
    </ConfirmCtx.Provider>
  );
}
