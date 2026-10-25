"use client";

import { AudioLines, KeyRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { inputCls } from "@/components/command/ui";

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState("ada@halden-rye.example");
  return (
    <div className="grid-bg grid min-h-screen place-items-center px-4">
      <form onSubmit={(e) => { e.preventDefault(); router.push("/command/ops"); }} className="w-full max-w-sm rounded-xl border border-cmd-line bg-cmd-panel p-6">
        <div className="flex items-center gap-2 font-mono text-sm tracking-[0.2em]"><AudioLines size={16} className="text-cmd-violet" /> VOXERA/CMD</div>
        <h1 className="mt-6 text-xl font-semibold">Sign in to your workspace</h1>
        <p className="mt-1 text-sm text-cmd-mute">Preview sign-in. No credentials are checked or stored.</p>
        <label className="mt-6 block font-mono text-[10px] uppercase tracking-[0.18em] text-cmd-mute" htmlFor="email">Work email</label>
        <input id="email" className={inputCls + " mt-1.5"} value={email} onChange={(e) => setEmail(e.target.value)} />
        <label className="mt-4 block font-mono text-[10px] uppercase tracking-[0.18em] text-cmd-mute" htmlFor="pw">Password</label>
        <input id="pw" type="password" className={inputCls + " mt-1.5"} defaultValue="demo-only" />
        <button className="mt-6 w-full rounded-md bg-cmd-violet py-2 font-medium text-white hover:bg-cmd-violet/85">Continue to demo console</button>
        <button type="button" onClick={() => router.push("/command/ops")} className="mt-2 flex w-full items-center justify-center gap-2 rounded-md border border-cmd-line py-2 text-sm hover:border-cmd-cyan"><KeyRound size={14} /> SSO (planned)</button>
        <p className="mt-6 text-center text-xs text-cmd-mute"><Link href="/command" className="hover:text-cmd-text">← Back</Link></p>
      </form>
    </div>
  );
}
