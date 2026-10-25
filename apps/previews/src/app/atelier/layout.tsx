import type { Metadata } from "next";

export const metadata: Metadata = { title: "B · Atelier" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return <div className="theme-atl min-h-screen">{children}</div>;
}
