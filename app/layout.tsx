import type { ReactNode } from "react";
import { GlobalStyles } from "@bigcommerce/big-design";
import "./globals.css";
import { StyledComponentsRegistry } from "@/lib/styled-registry";
import { UiProviders } from "@/components/ui/providers";

export const metadata = {
  title: "PO Agent",
  description: "Email-first purchase-order processing for BigCommerce B2B Edition.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <StyledComponentsRegistry>
          <GlobalStyles />
          <UiProviders>{children}</UiProviders>
        </StyledComponentsRegistry>
      </body>
    </html>
  );
}
