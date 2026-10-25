import type { Metadata } from "next";
import { SessionLoader } from "@/components/flow/session-loader";

export const metadata: Metadata = { title: "C · Flow" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="theme-flw min-h-screen">
      <SessionLoader />
      {children}
    </div>
  );
}
