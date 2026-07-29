import type { ReactNode } from "react";
import { Oswald, Raleway } from "next/font/google";
import "./globals.css";
import { UiProviders } from "@/components/ui/providers";

// Silk Commerce brand type: Oswald (display/headings) + Raleway (body). These expose
// their own variables; globals.css consumes them via var(--font-oswald, "Oswald") so the
// design tokens stay the single source of truth for the family stacks.
const oswald = Oswald({ subsets: ["latin"], weight: ["300", "400", "500", "600", "700"], variable: "--font-oswald", display: "swap" });
const raleway = Raleway({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-raleway", display: "swap" });

export const metadata = {
  title: "PO Agent",
  description: "Email-first purchase-order processing for BigCommerce B2B Edition.",
};

// Applied before first paint so reloading in dark theme never flashes light. Uses the
// design's storage key, so every Silk app shares one theme preference.
const THEME_BOOTSTRAP = `try{if(localStorage.getItem('silk-apps-theme')==='dark')document.documentElement.classList.add('dark')}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${oswald.variable} ${raleway.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>
        <UiProviders>{children}</UiProviders>
      </body>
    </html>
  );
}
