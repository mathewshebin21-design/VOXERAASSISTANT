"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { Card, Eyebrow, H2, Pill, Title } from "@/components/atelier/ui";
import { fmtIn, partOfDay, useWorkspaceDashboard } from "@/lib/live/dashboard";

const KIND = { transfer: "was put through to the team", callback: "would like a call back", message: "left a message" } as const;

/** "Today" for a signed-in studio: real bookings, real requests, gentle empty states. */
export function LiveToday({ orgId, orgName, firstName }: { orgId: string; orgName: string; firstName: string }) {
  const { data: d, error } = useWorkspaceDashboard(orgId);
  if (error) return <Card className="p-8"><H2>We couldn&apos;t open your studio</H2><p className="mt-2 text-atl-rose" role="alert">{error}</p></Card>;
  if (!d) return <div className="space-y-6"><div className="h-12 w-2/3 animate-pulse rounded-full bg-atl-line/60" /><div className="h-40 animate-pulse rounded-[22px] bg-atl-line/40" /></div>;
  const tz = d.timezone;
  const who = d.agentName ?? "Your receptionist";
  const dateLine = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date());

  return (
    <div className="space-y-12">
      <section>
        <Eyebrow>{dateLine} · {orgName}</Eyebrow>
        <Title className="mt-4">Good {partOfDay(tz)}, {firstName}.</Title>
        <p className="mt-5 max-w-2xl font-serif text-2xl leading-snug text-atl-soft" data-testid="atl-summary">
          {d.isNew
            ? <>Welcome to your studio. Nothing has happened here yet — once {who === "Your receptionist" ? "your receptionist" : who} is set up, bookings and messages will appear on this page.</>
            : <>You have <span className="text-atl-ink">{d.next7Days} {d.next7Days === 1 ? "appointment" : "appointments"}</span> in the next week{d.bookedByAi ? <>, <span className="text-atl-ink">{d.bookedByAi}</span> booked by {who}</> : null}, and <span className="text-atl-ink">{d.waiting.length} {d.waiting.length === 1 ? "request" : "requests"}</span> waiting for the team.</>}
        </p>
        <p className="mt-3 text-sm text-atl-soft">No phone line is connected yet, so there are no calls to report.</p>
      </section>

      {d.setupDone < d.setup.length && (
        <Card className="p-8">
          <div className="flex flex-wrap items-baseline justify-between gap-2"><H2>{d.isNew ? "A few things to set up" : "Almost there"}</H2><span className="text-sm text-atl-soft">{d.setupDone} of {d.setup.length} done</span></div>
          <ol className="mt-5 grid grid-cols-1 gap-x-10 gap-y-3 md:grid-cols-2" data-testid="atl-setup">
            {d.setup.map((s, i) => (
              <li key={s.id} className="flex items-center gap-3">
                <span className={"grid h-7 w-7 shrink-0 place-items-center rounded-full font-serif text-sm " + (s.done ? "bg-atl-sage/30 text-atl-ink" : "ring-1 ring-atl-line text-atl-soft")}>{s.done ? "✓" : i + 1}</span>
                <span className={"flex-1 " + (s.done ? "text-atl-soft line-through" : "")}>{s.label}</span>
                {!s.done && <Link href={s.href} className="inline-flex items-center gap-0.5 text-sm text-atl-champdeep hover:underline">Open <ArrowUpRight size={13} /></Link>}
              </li>
            ))}
          </ol>
          <p className="mt-5 text-xs text-atl-soft">Each step opens the setup assistant — a short conversation that fills everything in for you.</p>
        </Card>
      )}

      <section className="grid grid-cols-2 gap-px overflow-hidden rounded-[22px] border border-atl-line bg-atl-line md:grid-cols-4">
        {[
          ["Next seven days", String(d.next7Days), d.next7Days ? "appointments booked" : "nothing booked yet"],
          ["Booked by your receptionist", String(d.bookedByAi), "of the upcoming appointments"],
          ["Waiting for the team", String(d.waiting.length), d.urgent ? `${d.urgent} marked urgent` : "nothing urgent"],
          ["Team in", `${d.teamAvailable} of ${d.teamOnDesk}`, "available on the desk"],
        ].map(([k, v, s]) => (
          <div key={k} className="bg-atl-paper p-6"><div className="text-xs uppercase tracking-[0.2em] text-atl-soft">{k}</div><div className="mt-2 font-serif text-4xl">{v}</div><div className="mt-1 text-xs text-atl-soft">{s}</div></div>
        ))}
      </section>

      <section className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_1fr]">
        <div>
          <H2>Today in the studio</H2>
          <ol className="mt-5 divide-y divide-atl-line border-y border-atl-line" data-testid="atl-today">
            {d.today.map((a) => (
              <li key={a.id} className="flex items-center gap-4 py-3.5">
                <span className="w-16 font-serif text-xl">{fmtIn(a.starts_at, tz, { hour: "2-digit", minute: "2-digit" })}</span>
                <div className="min-w-0 flex-1"><div className="truncate">{a.customer_name}</div><div className="truncate text-xs text-atl-soft">{a.service_name}</div></div>
                {a.source === "ai_receptionist" && <Pill tone="champ">booked by {who}</Pill>}
              </li>
            ))}
            {!d.today.length && <li className="py-6 text-sm text-atl-soft">A quiet day — no appointments today.</li>}
          </ol>
          {d.upcoming.length > d.today.length && (
            <>
              <h3 className="mt-8 font-serif text-xl">Coming up</h3>
              <ul className="mt-3 space-y-2 text-sm" data-testid="atl-upcoming">
                {d.upcoming.filter((a) => !d.today.includes(a)).slice(0, 5).map((a) => (
                  <li key={a.id} className="flex justify-between gap-3"><span className="truncate">{a.customer_name} · {a.service_name}</span><span className="shrink-0 text-atl-soft">{fmtIn(a.starts_at, tz)}</span></li>
                ))}
              </ul>
            </>
          )}
        </div>
        <div>
          <div className="flex items-baseline justify-between"><H2>Needs your eye</H2><Link href="/flow/app/desk" className="text-sm text-atl-soft hover:text-atl-ink">Open the desk ↗</Link></div>
          <div className="mt-5 space-y-3" data-testid="atl-attention">
            {d.waiting.slice(0, 5).map((c) => (
              <Card key={c.id} as="div" className="flex items-start gap-4 p-5">
                <span className={"mt-1.5 h-2 w-2 shrink-0 rounded-full " + (c.urgent ? "bg-atl-rose" : "bg-atl-champ")} />
                <div className="min-w-0 flex-1"><div className="font-medium">{c.caller_name ?? "A caller"} {KIND[c.kind]}</div><div className="mt-0.5 line-clamp-2 text-sm text-atl-soft">{c.summary}</div></div>
              </Card>
            ))}
            {!d.waiting.length && <p className="text-sm text-atl-soft">Nothing waiting. Messages and calls the receptionist hands over will appear here.</p>}
          </div>
        </div>
      </section>
    </div>
  );
}
