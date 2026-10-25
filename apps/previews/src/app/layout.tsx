import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Cormorant_Garamond, Space_Grotesk } from "next/font/google";
import "@/styles/globals.css";
import { StoreHydrator } from "@/components/store-hydrator";

const sans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });
const serif = Cormorant_Garamond({ subsets: ["latin"], weight: ["400", "500", "600"], style: ["normal", "italic"], variable: "--font-serif", display: "swap" });
const display = Space_Grotesk({ subsets: ["latin"], variable: "--font-display", display: "swap" });

export const metadata: Metadata = {
  title: { default: "VOXERA AI — Design previews", template: "%s · VOXERA preview" },
  description: "Three interactive design directions for the VOXERA AI receptionist platform. Demo data only.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" className={`${sans.variable} ${mono.variable} ${serif.variable} ${display.variable}`}>
      <body className="font-sans">
        <StoreHydrator />
        {children}
      </body>
    </html>
  );
}
