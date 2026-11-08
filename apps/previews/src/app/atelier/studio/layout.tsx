import { WorkspaceGate } from "@/components/shared/workspace-gate";
import { AtelierShell } from "@/components/atelier/shell";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <WorkspaceGate><AtelierShell>{children}</AtelierShell></WorkspaceGate>;
}
