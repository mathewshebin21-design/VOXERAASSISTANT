import { AtelierShell } from "@/components/atelier/shell";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <AtelierShell>{children}</AtelierShell>;
}
