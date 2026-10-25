"use client";

import { Check } from "lucide-react";
import { Button, Card, DemoNote, Eyebrow, Pill, Title } from "@/components/atelier/ui";
import { INTEGRATIONS } from "@/lib/demo-data";

const ORDER = ["Calendar", "Telephony", "Messaging", "CRM", "Voxera suite", "Automation"] as const;
const WHY: Record<string, string> = {
  Calendar: "So the receptionist only offers times that are genuinely free.",
  Telephony: "Your studio number, answered. Connected only when you approve it.",
  Messaging: "Confirmations and reminders for your clients, alerts for you.",
  CRM: "Keep client records tidy after every call.",
  "Voxera suite": "Hand qualified enquiries to your other Voxera tools.",
  Automation: "Let your own systems hear about calls and bookings.",
};

export default function Connections() {
  return (
    <div className="space-y-12">
      <div><Eyebrow>Connections</Eyebrow><Title className="mt-4">The places your receptionist can reach.</Title>
        <p className="mt-4 max-w-2xl text-lg text-atl-soft">Each connection asks for the least access it needs, and every action it takes is written to your activity log.</p></div>
      {ORDER.map((cat) => (
        <section key={cat} className="grid grid-cols-1 gap-6 border-t border-atl-line pt-8 lg:grid-cols-[280px_1fr]">
          <div><div className="font-serif text-2xl">{cat}</div><p className="mt-1 text-sm text-atl-soft">{WHY[cat]}</p></div>
          <div className="grid gap-4 sm:grid-cols-2">
            {INTEGRATIONS.filter((i) => i.category === cat).map((i) => (
              <Card key={i.id} className="flex flex-col p-6">
                <div className="flex items-start justify-between gap-2"><div className="font-serif text-xl">{i.name}</div>
                  {i.status === "connected" ? <Pill tone="sage"><Check size={11} className="mr-1" />Connected · demo</Pill> : i.status === "planned" ? <Pill>Coming later</Pill> : <Pill tone="champ">Available</Pill>}</div>
                <p className="mt-2 flex-1 text-sm text-atl-soft">{i.description}</p>
                <div className="mt-5 flex items-center justify-between text-xs text-atl-soft"><span>{i.auth}</span>
                  <Button variant={i.status === "connected" ? "quiet" : "outline"} disabled title="Inactive in the preview">{i.status === "connected" ? "Manage" : "Connect"}</Button></div>
              </Card>
            ))}
          </div>
        </section>
      ))}
      <DemoNote>No account is actually connected in this preview. Connection flows (OAuth consent, scope review, token storage) arrive in Phase 8.</DemoNote>
    </div>
  );
}
