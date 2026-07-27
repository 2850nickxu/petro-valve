import type { ReactNode } from "react";
import { Oswald, Raleway } from "next/font/google";
import "./globals.css";

// Silk Commerce brand type: Oswald (display/headings) + Raleway (body).
const oswald = Oswald({ subsets: ["latin"], weight: ["300", "400", "500", "600", "700"], variable: "--font-display", display: "swap" });
const raleway = Raleway({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-body", display: "swap" });

export const metadata = {
  title: "PO Agent",
  description: "Email-first purchase-order processing for BigCommerce B2B Edition.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${oswald.variable} ${raleway.variable}`}>
      <body>{children}</body>
    </html>
  );
}
