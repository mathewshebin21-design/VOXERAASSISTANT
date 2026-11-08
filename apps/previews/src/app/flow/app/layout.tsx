import { WorkspaceGate } from "@/components/shared/workspace-gate";
import { FlowShell } from "@/components/flow/shell";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <WorkspaceGate><FlowShell>{children}</FlowShell></WorkspaceGate>;
}
