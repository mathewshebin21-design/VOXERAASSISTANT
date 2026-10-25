"use client";

import { clsx } from "clsx";
import { Check, Lock } from "lucide-react";
import { useState } from "react";
import { Button, Card, DemoNote, Eyebrow, H2, Pill, Title } from "@/components/atelier/ui";
import { INTEGRATIONS } from "@/lib/demo-data";
import { usePreview } from "@/lib/store";
import type { Integration } from "@/lib/types";

const ORDER = ["Calendar", "Telephony", "Messaging", "CRM", "Voxera suite", "Automation"] as const;
const WHY: Record<string, string> = {
  Calendar: "So the receptionist only offers times that are genuinely free.",
  Telephony: "Your studio number, answered. Connected only when you approve it.",
  Messaging: "Confirmations and reminders for your clients, alerts for you.",
  CRM: "Keep client records tidy after every call.",
  "Voxera suite": "Hand qualified enquiries to your other Voxera tools.",
  Automation: "Let your own systems hear about calls and bookings.",
};

// Every action the receptionist can take, where it acts, and whether it can be switched off.
const ACTIONS = [
  { name: "check_availability", plain: "Look in the diary", via: "Google Calendar (demo)", risk: "reads only", group: "booking" },
  { name: "create_booking", plain: "Make a booking", via: "Google Calendar (demo)", risk: "writes · needs the caller's yes", group: "booking" },
  { name: "reschedule_booking", plain: "Move a booking", via: "Google Calendar (demo)", risk: "writes · needs the caller's yes", group: "booking" },
  { name: "cancel_booking", plain: "Cancel a booking", via: "Google Calendar (demo)", risk: "writes · needs the caller's yes", group: "booking" },
  { name: "search_knowledge", plain: "Look in the Notebook", via: "Your Notebook", risk: "reads only", group: "always" },
  { name: "take_message", plain: "Take a message", via: "Email notifications", risk: "writes · internal", group: "always" },
  { name: "escalate", plain: "Raise an urgent alert", via: "SMS to the owner (demo)", risk: "alerts you", group: "always" },
  { name: "transfer_call", plain: "Pass the call to the team", via: "Phone line — not connected", risk: "call control", group: "transfer" },
  { name: "crm_upsert_contact", plain: "Update the client record", via: "HubSpot — not connected", risk: "writes · external", group: "needs" },
] as const;

const DELIVERIES = [
  ["09:14", "call.completed", true, "first try"], ["09:14", "appointment.created", true, "first try"], ["11:02", "call.completed", false, "server error"],
  ["11:02", "call.completed", true, "second try"], ["13:30", "message.taken", true, "first try"],
] as const;

export default function Connections() {
  const p = usePreview((s) => s.draft.persona);
  const setPersona = usePreview((s) => s.setPersona);
  const [sel, setSel] = useState<Integration>(INTEGRATIONS[0]);
  const on = (g: string) => (g === "booking" ? p.allowBooking : g === "transfer" ? p.allowTransfer : g === "always");

  return (
    <div className="space-y-12">
      <div><Eyebrow>Connections</Eyebrow><Title className="mt-4">The places your receptionist can reach.</Title>
        <p className="mt-4 max-w-2xl text-lg text-atl-soft">Each connection asks for the least access it needs, and every action it takes is written to your activity log.</p></div>

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-[1fr_380px]">
        <div className="space-y-10">
          {ORDER.map((cat) => (
            <section key={cat} className="grid grid-cols-1 gap-6 border-t border-atl-line pt-8 lg:grid-cols-[220px_1fr]">
              <div><div className="font-serif text-2xl">{cat}</div><p className="mt-1 text-sm text-atl-soft">{WHY[cat]}</p></div>
              <div className="grid gap-4 sm:grid-cols-2">
                {INTEGRATIONS.filter((i) => i.category === cat).map((i) => (
                  <button key={i.id} onClick={() => setSel(i)} className="text-left">
                    <Card className={clsx("flex h-full flex-col p-6 transition hover:border-atl-champ", sel.id === i.id && "ring-1 ring-atl-champdeep")}>
                      <div className="flex items-start justify-between gap-2"><div className="font-serif text-xl">{i.name}</div>
                        {i.status === "connected" ? <Pill tone="sage"><Check size={11} className="mr-1" />Connected · demo</Pill> : i.status === "planned" ? <Pill>Coming later</Pill> : <Pill tone="champ">Available</Pill>}</div>
                      <p className="mt-2 flex-1 text-sm text-atl-soft">{i.description}</p>
                      <div className="mt-4 text-xs text-atl-soft">{i.auth}</div>
                    </Card>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
        <div className="space-y-6 xl:sticky xl:top-40 xl:self-start">
          <Card className="p-7">
            <div className="text-xs uppercase tracking-[0.2em] text-atl-soft">{sel.category}</div>
            <div className="mt-2 font-serif text-3xl">{sel.name}</div>
            <p className="mt-2 text-sm text-atl-soft">{sel.description}</p>
            <dl className="mt-5 space-y-3 text-sm">
              <div className="flex justify-between gap-4 border-b border-atl-line pb-2"><dt className="text-atl-soft">How it connects</dt><dd>{sel.auth}</dd></div>
              <div className="flex justify-between gap-4 border-b border-atl-line pb-2"><dt className="text-atl-soft">Access requested</dt><dd className="text-right">{sel.scopes?.join(", ") ?? "least access, agreed when connecting"}</dd></div>
              <div className="flex justify-between gap-4 border-b border-atl-line pb-2"><dt className="text-atl-soft">Where keys are kept</dt><dd className="text-right">Encrypted vault, your studio only</dd></div>
            </dl>
            <Button className="mt-6 w-full" variant={sel.status === "connected" ? "outline" : "solid"} disabled title="Inactive in the preview">{sel.status === "connected" ? "Disconnect" : sel.status === "planned" ? "Coming later" : "Connect"}</Button>
            <p className="mt-3 text-xs italic text-atl-soft">Buttons are inactive in the preview. Sign-in with each provider arrives in Phase 8.</p>
          </Card>
          <Card className="p-7">
            <div className="font-serif text-xl">Messages sent to your systems</div>
            <ol className="mt-4 divide-y divide-atl-line text-sm">
              {DELIVERIES.map(([t, ev, ok, note], i) => (
                <li key={i} className="flex items-center gap-3 py-2"><span className="w-12 font-serif text-lg">{t}</span><span className="min-w-0 flex-1 truncate font-mono text-xs">{ev}</span><Pill tone={ok ? "sage" : "rose"}>{ok ? "delivered" : "failed"}</Pill><span className="w-16 text-right text-xs text-atl-soft">{note}</span></li>
              ))}
            </ol>
            <p className="mt-3 text-xs italic text-atl-soft">Each message is signed, retried with growing gaps, and keeps the same ID on retry so nothing is processed twice. Demo entries.</p>
          </Card>
        </div>
      </div>

      <section>
        <H2>Everything {p.agentName} is allowed to do</H2>
        <p className="mt-2 text-atl-soft">Every action is checked before it runs, recorded, and safe to repeat.</p>
        <Card className="mt-6 divide-y divide-atl-line">
          {ACTIONS.map((a) => (
            <div key={a.name} className="flex flex-wrap items-center gap-4 p-5">
              <span className={clsx("h-2.5 w-2.5 rounded-full", on(a.group) ? "bg-atl-sage" : "bg-atl-line")} />
              <div className="min-w-0 flex-1"><div className="font-medium">{a.plain} <span className="ml-1 font-mono text-xs text-atl-soft">{a.name}</span></div><div className="text-sm text-atl-soft">{a.via} · {a.risk}</div></div>
              {a.group === "always" ? <Pill><Lock size={10} className="mr-1" />always on</Pill>
                : a.group === "booking" ? <Button variant="outline" onClick={() => setPersona({ allowBooking: !p.allowBooking })}>{p.allowBooking ? "Switch off booking" : "Allow booking"}</Button>
                : a.group === "transfer" ? <Button variant="outline" onClick={() => setPersona({ allowTransfer: !p.allowTransfer })}>{p.allowTransfer ? "Switch off" : "Allow"}</Button>
                : <Pill>needs a connection</Pill>}
            </div>
          ))}
        </Card>
      </section>
      <DemoNote>No account is actually connected in this preview.</DemoNote>
    </div>
  );
}
