import type { Metadata } from "next";

export const metadata: Metadata = { title: "A · Command" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return <div className="theme-cmd min-h-screen font-sans">{children}</div>;
}
