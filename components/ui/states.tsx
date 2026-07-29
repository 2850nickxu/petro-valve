import type { ReactNode } from "react";

// Server-safe presentational states. Banner distinguishes "backend is down" from an
// ordinary empty list; EmptyState/ErrorState give lists a consistent, non-alarming look.

export function Banner({ kind = "info", title, children }: { kind?: "info" | "warn" | "error" | "ok"; title?: ReactNode; children?: ReactNode }) {
  return (
    <div className={`banner ${kind}`} role={kind === "error" ? "alert" : undefined}>
      <div>
        {title && <div className="banner-title">{title}</div>}
        {children && <div>{children}</div>}
      </div>
    </div>
  );
}

export function EmptyState({ icon = "○", title, children }: { icon?: ReactNode; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="emptystate">
      <div className="es-icon">{icon}</div>
      <div className="es-title">{title}</div>
      {children && <div className="es-body">{children}</div>}
    </div>
  );
}

export function ErrorState({ title = "Something went wrong", children }: { title?: ReactNode; children?: ReactNode }) {
  return (
    <div className="emptystate">
      <div className="es-icon bad">!</div>
      <div className="es-title">{title}</div>
      {children && <div className="es-body">{children}</div>}
    </div>
  );
}
