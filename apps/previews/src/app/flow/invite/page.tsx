"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { FBtn, Glass } from "@/components/flow/ui";
import { api, ApiError, type MyOrg } from "@/lib/live/api";
import { useSession } from "@/lib/live/session";

function Invite() {
  const sp = useSearchParams();
  const router = useRouter();
  const token = sp.get("token") ?? "";
  const { status, user, reloadOrgs, switchOrg } = useSession();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const here = `/flow/invite?token=${encodeURIComponent(token)}`;

  const accept = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api<MyOrg>("/invitations/accept", { method: "POST", body: { token } });
      await reloadOrgs();
      switchOrg(r.organization.id);
      router.push("/flow/app/workspace");
    } catch (e) {
      setErr(e instanceof ApiError ? e.detail : "Could not accept the invitation");
    } finally { setBusy(false); }
  };

  return (
    <div className="relative grid min-h-screen place-items-center px-4">
      <div className="flw-aurora pointer-events-none absolute inset-0" />
      <Glass className="relative z-10 w-full max-w-md p-7" glow="violet">
        <h1 className="font-display text-2xl font-semibold">Join a workspace</h1>
        {!token ? <p className="mt-3 text-sm text-flw-pink">This link has no invitation token.</p>
          : status === "loading" ? <p className="mt-3 text-sm text-flw-mute">Checking your session…</p>
          : status === "anonymous" ? (
            <div className="mt-4 space-y-3 text-sm text-flw-mute">
              <p>Sign in — or create an account — with the email address the invitation was sent to.</p>
              <div className="flex gap-2">
                <Link href={`/flow/enter?next=${encodeURIComponent(here)}`}><FBtn variant="glow">Sign in</FBtn></Link>
                <Link href={`/flow/enter?mode=signup&next=${encodeURIComponent(here)}`}><FBtn>Create account</FBtn></Link>
              </div>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              <p className="text-sm text-flw-mute">Signed in as <span className="text-flw-text">{user?.email}</span>.</p>
              {err && <p role="alert" className="text-sm text-flw-pink">{err}</p>}
              <FBtn variant="glow" disabled={busy} onClick={accept}>{busy ? "Joining…" : "Accept invitation"}</FBtn>
            </div>
          )}
        <p className="mt-6 border-t border-flw-line/70 pt-4 text-xs text-flw-mute">Invitations are handled by the VOXERA API. Just looking? <Link href="/flow/app" className="text-flw-cyan">Explore the demo</Link> with simulated data.</p>
      </Glass>
    </div>
  );
}

export default function Page() {
  return <Suspense><Invite /></Suspense>;
}
