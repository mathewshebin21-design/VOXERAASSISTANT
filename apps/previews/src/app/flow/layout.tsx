import type { Metadata } from "next";

export const metadata: Metadata = { title: "C · Flow" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return <div className="theme-flw min-h-screen">{children}</div>;
}
