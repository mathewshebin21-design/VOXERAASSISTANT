import { FlowShell } from "@/components/flow/shell";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <FlowShell>{children}</FlowShell>;
}
