import type { Metadata } from "next";
import { SessionLoader } from "@/components/shared/session-loader";

export const metadata: Metadata = { title: "Sign in" };

export default function StartLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-[#0b0b0f] text-[#e8e8f0]"><SessionLoader />{children}</div>;
}
