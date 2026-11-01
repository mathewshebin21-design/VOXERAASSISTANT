import type { Metadata } from "next";
import { SessionLoader } from "@/components/shared/session-loader";

export const metadata: Metadata = { title: "B · Atelier" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return <div className="theme-atl min-h-screen"><SessionLoader />{children}</div>;
}
