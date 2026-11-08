import { WorkspaceGate } from "@/components/shared/workspace-gate";
import { CommandShell } from "@/components/command/shell";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <WorkspaceGate><CommandShell>{children}</CommandShell></WorkspaceGate>;
}
