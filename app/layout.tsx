import type { ReactNode } from "react";
import "@/styles/backbone/index.css";
import "./globals.css";
import { UiProviders } from "@/components/ui/providers";

export const metadata = {
  title: "PO Agent",
  description: "Email-first purchase-order processing for BigCommerce B2B Edition.",
};

// One product theme, set once on <html> per the Backbone Layer-2 contract: indigo accent,
// pure neutral (no data-neutral) — the documented preset for an operational console. The
// design-system stylesheet (tokens + base layer + self-hosted fonts) is the only global CSS.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-accent="indigo" suppressHydrationWarning>
      <body>
        <UiProviders>{children}</UiProviders>
      </body>
    </html>
  );
}
