"use client";

import { useEffect } from "react";
import { useSession } from "@/lib/live/session";

/** Loads the signed-in user (if any) once for every Flow page. */
export function SessionLoader() {
  const load = useSession((s) => s.load);
  useEffect(() => { void load(); }, [load]);
  return null;
}
