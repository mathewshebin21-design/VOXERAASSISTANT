import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "@/styles/globals.css";
import { StoreHydrator } from "@/components/store-hydrator";

// Fonts are bundled (src/fonts, SIL Open Font License 1.1, licences alongside) so builds never
// download from Google Fonts. Same latin-subset files Google serves; see src/fonts/README.md.
// The size-matched fallbacks ("… Fallback", in styles/globals.css) keep next/font/google's exact metrics.
const inter = localFont({
  src: [{ path: "../fonts/Inter-latin-variable.woff2", weight: "100 900", style: "normal" }],
  variable: "--font-sans",
  display: "swap",
  adjustFontFallback: false,
  fallback: ["Inter Fallback"],
});
const jetbrainsMono = localFont({
  src: [{ path: "../fonts/JetBrainsMono-latin-variable.woff2", weight: "100 800", style: "normal" }],
  variable: "--font-mono",
  display: "swap",
  adjustFontFallback: false,
  fallback: ["JetBrains Mono Fallback"],
});
const cormorantGaramond = localFont({
  src: [
    { path: "../fonts/CormorantGaramond-latin-variable.woff2", weight: "400 600", style: "normal" },
    { path: "../fonts/CormorantGaramond-Italic-latin-variable.woff2", weight: "400 600", style: "italic" },
  ],
  variable: "--font-serif",
  display: "swap",
  adjustFontFallback: false,
  fallback: ["Cormorant Garamond Fallback"],
});
const spaceGrotesk = localFont({
  src: [{ path: "../fonts/SpaceGrotesk-latin-variable.woff2", weight: "300 700", style: "normal" }],
  variable: "--font-display",
  display: "swap",
  adjustFontFallback: false,
  fallback: ["Space Grotesk Fallback"],
});

export const metadata: Metadata = {
  title: { default: "VOXERA AI — Design previews", template: "%s · VOXERA preview" },
  description: "Three interactive design directions for the VOXERA AI receptionist platform. Demo data only.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" className={`${inter.variable} ${jetbrainsMono.variable} ${cormorantGaramond.variable} ${spaceGrotesk.variable}`}>
      <body className="font-sans">
        <StoreHydrator />
        {children}
      </body>
    </html>
  );
}
