"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { field } from "@/components/atelier/ui";

export default function SignIn() {
  const router = useRouter();
  return (
    <div className="atl-grain grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-atl-ink p-14 text-atl-paper lg:flex">
        <span className="font-serif text-2xl">Voxera <span className="italic text-atl-champ">Atelier</span></span>
        <blockquote className="font-serif text-4xl leading-tight">“It answers the phone the way I would — if I weren&apos;t mid-balayage.”<footer className="mt-4 font-sans text-sm text-atl-paper/60">— illustrative quote, demo studio</footer></blockquote>
        <span className="text-xs text-atl-paper/50">Design preview B</span>
      </div>
      <div className="grid place-items-center px-6">
        <form onSubmit={(e) => { e.preventDefault(); router.push("/atelier/studio"); }} className="w-full max-w-sm">
          <h1 className="font-serif text-4xl">Welcome back</h1>
          <p className="mt-2 text-sm text-atl-soft">Demo sign-in — nothing is checked or stored.</p>
          <label htmlFor="e" className="mt-8 block text-sm font-medium">Email</label>
          <input id="e" className={field + " mt-2"} defaultValue="ada@halden-rye.example" />
          <label htmlFor="p" className="mt-4 block text-sm font-medium">Password</label>
          <input id="p" type="password" className={field + " mt-2"} defaultValue="demo-only" />
          <button className="mt-8 w-full rounded-full bg-atl-ink py-3 text-atl-paper hover:bg-atl-ink/85">Enter the demo studio</button>
          <p className="mt-6 text-center text-sm text-atl-soft"><Link href="/atelier" className="underline-offset-4 hover:underline">Return to the front page</Link></p>
        </form>
      </div>
    </div>
  );
}
