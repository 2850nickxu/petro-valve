import type { ReactNode } from "react";
import { AdminNav } from "./nav";

export const dynamic = "force-dynamic";

export default function StaffLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AdminNav />
      <div className="container">{children}</div>
    </>
  );
}
