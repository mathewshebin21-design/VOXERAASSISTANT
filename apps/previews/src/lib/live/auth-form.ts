"use client";

// Sign in / create workspace, shared by every design. Each design renders its own form.

import { useState } from "react";
import { ApiError } from "./api";
import { useDemoView } from "./data-mode";
import { useSession } from "./session";

export type AuthMode = "in" | "up";
export interface AuthFields { email: string; password: string; full_name: string; organization_name: string }

export function authErrorMessage(x: unknown): string {
  if (x instanceof ApiError) return x.status === 0 ? "The VOXERA API isn't reachable right now. Try again in a moment." : x.detail;
  return "Something went wrong";
}

export function useAuthForm(opts: { initialMode?: AuthMode; email?: string; onDone: () => void }) {
  const { signIn, signUp } = useSession();
  const setDemo = useDemoView((s) => s.set);
  const [mode, setModeRaw] = useState<AuthMode>(opts.initialMode ?? "in");
  const [f, setF] = useState<AuthFields>({ email: opts.email ?? "", password: "", full_name: "", organization_name: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const setMode = (m: AuthMode) => { setModeRaw(m); setErr(null); };
  const submit = async (e?: { preventDefault(): void }) => {
    e?.preventDefault();
    setBusy(true); setErr(null);
    try {
      if (mode === "in") await signIn(f.email, f.password);
      else await signUp(f);
      setDemo(false); // signing in always lands on the real workspace
      opts.onDone();
    } catch (x) {
      setErr(authErrorMessage(x));
    } finally {
      setBusy(false);
    }
  };
  return { mode, setMode, f, setF, err, busy, submit, minPassword: mode === "up" ? 12 : 1 };
}
