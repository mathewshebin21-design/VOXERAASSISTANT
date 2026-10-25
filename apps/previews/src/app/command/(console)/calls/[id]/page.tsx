import { notFound } from "next/navigation";
import { callById } from "@/lib/demo-data";
import { TranscriptView } from "./view";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const call = callById(id);
  if (!call) notFound();
  return <TranscriptView id={call.id} />;
}
