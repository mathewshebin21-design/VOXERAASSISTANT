"use client";

import { useEffect } from "react";
import { useDemoView } from "@/lib/live/data-mode";
import { useSession } from "@/lib/live/session";

/** Loads the signed-in user (if any) and the demo/live choice once for every page of a design. */
export function SessionLoader() {
  const load = useSession((s) => s.load);
  const hydrate = useDemoView((s) => s.hydrate);
  useEffect(() => { hydrate(); void load(); }, [load, hydrate]);
  return null;
}
