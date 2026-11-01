"use client";

import { NeedsSignIn, Notice } from "@/components/flow/live-ui";
import { SetupAssistant } from "@/components/flow/setup-assistant";
import { Heading } from "@/components/flow/ui";
import { PERMS } from "@/lib/live/api";
import { useActiveOrg, useSession } from "@/lib/live/session";

export default function SetupPage() {
  const status = useSession((s) => s.status);
  const user = useSession((s) => s.user);
  const active = useActiveOrg();
  if (status === "loading") return null;
  return (
    <>
      <Heading kicker="Setup assistant" title="Let's get your business set up" />
      {!active ? <NeedsSignIn what="your workspace setup" />
        : !PERMS[active.role].write ? <Notice>Only owners and admins can change the workspace setup. Ask the owner of {active.organization.name}.</Notice>
        : <SetupAssistant key={active.organization.id} orgId={active.organization.id} firstName={(user?.full_name ?? "").split(" ")[0] || "there"} />}
    </>
  );
}
