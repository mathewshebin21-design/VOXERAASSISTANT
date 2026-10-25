import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Journal } from "@/components/atelier/journal";
import { callById } from "@/lib/demo-data";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!callById(id)) notFound();
  return <Suspense><Journal selectedId={id} /></Suspense>;
}
