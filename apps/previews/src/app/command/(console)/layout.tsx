import { CommandShell } from "@/components/command/shell";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <CommandShell>{children}</CommandShell>;
}
