import { Suspense } from "react";
import { CallsView } from "./list";

export default function Page() {
  return <Suspense><CallsView /></Suspense>;
}
