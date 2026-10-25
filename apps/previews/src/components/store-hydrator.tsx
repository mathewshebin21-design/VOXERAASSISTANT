"use client";

import { useEffect } from "react";
import { usePreview } from "@/lib/store";

/** Rehydrates persisted preview state after mount to avoid SSR mismatches. */
export function StoreHydrator() {
  useEffect(() => {
    void usePreview.persist.rehydrate();
  }, []);
  return null;
}
