import { notFound } from "next/navigation";
import { Suspense } from "react";
import { callById } from "@/lib/demo-data";
import { CallsView } from "../list";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!callById(id)) notFound();
  return <Suspense><CallsView id={id} /></Suspense>;
}
