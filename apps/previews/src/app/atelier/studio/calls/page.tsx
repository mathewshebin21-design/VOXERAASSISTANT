import { Suspense } from "react";
import { Journal } from "@/components/atelier/journal";

export default function Page() {
  return <Suspense><Journal /></Suspense>;
}
