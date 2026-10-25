"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { finput, Glass, Orb } from "@/components/flow/ui";

export default function Enter() {
  const router = useRouter();
  return (
    <div className="relative grid min-h-screen place-items-center px-4">
      <div className="flw-aurora pointer-events-none absolute inset-0" />
      <Glass className="relative z-10 w-full max-w-sm p-7" glow="violet">
        <div className="flex justify-center"><Orb level={0.4} size={90} /></div>
        <h1 className="mt-5 text-center font-display text-2xl font-semibold">Enter Flow</h1>
        <p className="mt-1 text-center text-sm text-flw-mute">Demo sign-in. No credentials are checked.</p>
        <form className="mt-6 space-y-3" onSubmit={(e) => { e.preventDefault(); router.push("/flow/app"); }}>
          <input aria-label="Email" className={finput} defaultValue="ada@halden-rye.example" />
          <input aria-label="Password" type="password" className={finput} defaultValue="demo-only" />
          <button className="w-full rounded-xl bg-gradient-to-r from-flw-violet to-flw-cyan py-2.5 font-medium text-flw-bg">Continue</button>
        </form>
        <p className="mt-5 text-center text-xs text-flw-mute"><Link href="/flow">← back</Link></p>
      </Glass>
    </div>
  );
}
