import type { Metadata } from "next";
import { SessionLoader } from "@/components/shared/session-loader";

export const metadata: Metadata = { title: "A · Command" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return <div className="theme-cmd min-h-screen font-sans"><SessionLoader />{children}</div>;
}
