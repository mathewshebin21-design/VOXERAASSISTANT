"use client";

import { clsx } from "clsx";
import { AlertTriangle, CalendarPlus, Check, Hand, Headset, PhoneForwarded, PhoneIncoming, RotateCcw, StickyNote, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { fmtWhen, NeedsSignIn, Notice } from "@/components/flow/live-ui";
import { Chip, FBtn, finput, finputAuto, Glass, GHead, Heading } from "@/components/flow/ui";
import { api, ApiError, PERMS, type Appointment, type DeskCase, type DeskMember, type DeskStatus, type Service } from "@/lib/live/api";
import { useActiveOrg, useApi, useSession } from "@/lib/live/session";

const POLL_MS = 5000;
const KIND: Record<DeskCase["kind"], { label: string; icon: typeof Hand; tone: "violet" | "cyan" | "amber" }> = {
  transfer: { label: "Transferred call", icon: PhoneForwarded, tone: "violet" },
  callback: { label: "Call back", icon: PhoneIncoming, tone: "amber" },
  message: { label: "Message", icon: StickyNote, tone: "cyan" },
};
const DOT: Record<DeskStatus, string> = { available: "bg-flw-lime", busy: "bg-flw-amber", offline: "bg-flw-line" };
const TABS = [
  { id: "queue", label: "Queue", q: "status=new" },
  { id: "mine", label: "Mine", q: "status=in_progress&mine=true" },
  { id: "open", label: "All open", q: "status=in_progress" },
  { id: "resolved", label: "Resolved", q: "status=resolved&limit=50" },
] as const;

/** Re-fetches on an interval while the tab is visible, so several employees see the same desk. */
function usePolled<T>(path: string | null) {
  const r = useApi<T>(path);
  const { reload } = r;
  useEffect(() => {
    if (!path) return;
    const t = setInterval(() => { if (document.visibilityState === "visible") void reload(); }, POLL_MS);
    return () => clearInterval(t);
  }, [path, reload]);
  return r;
}

export default function DeskPage() {
  const status = useSession((s) => s.status);
  const active = useActiveOrg();
  if (status === "loading") return null;
  if (!active) return (
    <>
      <Heading kicker="Staff desk" title="Where people take over from the AI" />
      <NeedsSignIn what="the staff desk" />
      <p className="mx-auto mt-4 max-w-xl text-center text-sm text-flw-mute">Your team marks themselves available. When the receptionist can’t help, it hands the caller to the least-busy available person, with a summary so nobody repeats themselves. Messages and callbacks land in a shared queue that several people can work at once.</p>
    </>
  );
  if (!PERMS[active.role].desk) return <><Heading kicker="Staff desk" title="Staff desk" /><Notice>Your role ({active.role}) can’t work the desk. Ask an owner to make you Staff or Manager.</Notice></>;
  return <Desk orgId={active.organization.id} />;
}

function Desk({ orgId }: { orgId: string }) {
  const base = `/orgs/${orgId}`;
  const me = useSession((s) => s.user);
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("queue");
  const [selected, setSelected] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const team = usePolled<DeskMember[]>(`${base}/desk/team`);
  const cases = usePolled<DeskCase[]>(`${base}/cases?${TABS.find((t) => t.id === tab)!.q}`);
  const queue = usePolled<DeskCase[]>(`${base}/cases?status=new`);
  const mine = team.data?.find((m) => m.user_id === me?.id);

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    try { await fn(); if (ok) setMsg({ kind: "ok", text: ok }); await Promise.all([team.reload(), cases.reload(), queue.reload()]); }
    catch (e) { setMsg({ kind: "error", text: e instanceof ApiError ? e.detail : "Something went wrong" }); await cases.reload(); }
  };
  const setPresence = (s: DeskStatus) => act(() => api(`${base}/desk/presence`, { method: "PUT", body: { status: s } }), `You're ${s}`);

  return (
    <>
      <Heading kicker="Staff desk · live" title="Calls and requests for your team">
        <div className="flex items-center gap-1 rounded-xl border border-flw-line bg-flw-surface/60 p-1" role="radiogroup" aria-label="My desk status">
          {(["available", "busy", "offline"] as DeskStatus[]).map((s) => (
            <button key={s} role="radio" aria-checked={mine?.status === s} onClick={() => void setPresence(s)} className={clsx("flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs capitalize", mine?.status === s ? "bg-flw-violet/25 text-flw-text" : "text-flw-mute hover:text-flw-text")}>
              <span className={clsx("h-2 w-2 rounded-full", DOT[s])} />{s}
            </button>
          ))}
        </div>
      </Heading>
      {msg && <div className="mb-3"><Notice kind={msg.kind}>{msg.text}</Notice></div>}
      {mine?.status !== "available" && <div className="mb-3"><Notice>You won’t receive transferred calls until you’re <b>available</b>. Everyone available shares the load: each new transfer goes to whoever has the fewest open cases.</Notice></div>}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.6fr_1fr]">
        <Glass>
          <div className="flex flex-wrap items-center gap-1 border-b border-flw-line/70 px-3 py-2" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={clsx("rounded-lg px-3 py-1.5 text-sm", tab === t.id ? "bg-flw-violet/20 text-flw-text" : "text-flw-mute hover:text-flw-text")}>
                {t.label}{t.id === "queue" && !!queue.data?.length && <span className="ml-1.5 rounded-full bg-flw-amber/20 px-1.5 font-mono text-[10px] text-flw-amber" data-testid="queue-count">{queue.data.length}</span>}
              </button>
            ))}
            <span className="ml-auto font-mono text-[10px] text-flw-mute">updates every {POLL_MS / 1000}s</span>
          </div>
          <ul className="divide-y divide-flw-line/60" data-testid="case-list">
            {cases.data?.length === 0 && <li className="p-6 text-center text-sm text-flw-mute">{tab === "queue" ? "Nothing waiting. New messages and transfers appear here." : "Nothing here."}</li>}
            {cases.data?.map((c) => {
              const k = KIND[c.kind];
              return (
                <li key={c.id} className={clsx("flex items-start gap-3 p-3", selected === c.id && "bg-flw-violet/10")}>
                  <k.icon size={16} className="mt-1 shrink-0 text-flw-mute" />
                  <button className="min-w-0 flex-1 text-left" onClick={() => setSelected(c.id)}>
                    <div className="flex flex-wrap items-center gap-1.5 text-sm">
                      <span className="font-medium">{c.caller_name ?? "Unknown caller"}</span>
                      {c.caller_phone && <span className="font-mono text-xs text-flw-mute">{c.caller_phone}</span>}
                      <Chip tone={k.tone}>{k.label}</Chip>
                      {c.urgent && <Chip tone="pink"><AlertTriangle size={10} /> urgent</Chip>}
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-sm text-flw-mute">{c.summary}</p>
                    <div className="mt-1 font-mono text-[10px] text-flw-mute">{fmtWhen(c.created_at)}{c.assignee_name && <> · with {c.assignee_name}</>}{c.source === "ai_receptionist" && <> · from the AI receptionist</>}</div>
                  </button>
                  {c.status === "new" && <FBtn variant="glow" onClick={() => void act(async () => { await api(`${base}/cases/${c.id}/claim`, { method: "POST" }); setSelected(c.id); }, "It's yours")}><Hand size={13} /> Take it</FBtn>}
                </li>
              );
            })}
          </ul>
        </Glass>

        <div className="min-w-0 space-y-4">
          {selected && <CaseDetail key={selected} base={base} id={selected} team={team.data ?? []} onAct={act} onClose={() => setSelected(null)} />}
          <Glass>
            <GHead title={<span className="flex items-center gap-2"><Headset size={14} /> Team on the desk</span>} />
            <ul className="space-y-1.5 p-4" data-testid="desk-team">
              {team.data?.map((m) => (
                <li key={m.user_id} className="flex items-center gap-2 text-sm">
                  <span className={clsx("h-2.5 w-2.5 rounded-full", DOT[m.status])} title={m.status} />
                  <span className="flex-1 truncate">{m.full_name}{m.user_id === me?.id && <span className="text-flw-mute"> (you)</span>}</span>
                  <span className="text-xs capitalize text-flw-mute">{m.status}</span>
                  <span className="w-14 text-right font-mono text-[11px] text-flw-mute">{m.open_cases} open</span>
                </li>
              ))}
            </ul>
            <p className="px-4 pb-4 text-[11px] text-flw-mute">Invite front-desk employees with the <b>Staff</b> role on the Team page: they can take calls, work cases and manage bookings, but can’t change business settings.</p>
          </Glass>
          <Bookings base={base} />
        </div>
      </div>
    </>
  );
}

function CaseDetail({ base, id, team, onAct, onClose }: { base: string; id: string; team: DeskMember[]; onAct: (fn: () => Promise<unknown>, ok?: string) => Promise<void>; onClose: () => void }) {
  const c = usePolled<DeskCase>(`${base}/cases/${id}`);
  const [note, setNote] = useState("");
  const [resolution, setResolution] = useState("");
  const d = c.data;
  if (!d) return <Glass className="p-4 text-sm text-flw-mute">Loading case…</Glass>;
  const run = (fn: () => Promise<unknown>, ok?: string) => onAct(async () => { await fn(); await c.reload(); }, ok);
  return (
    <Glass glow="violet">
      <GHead title={<span>{KIND[d.kind].label} · {d.caller_name ?? "Unknown caller"}</span>} right={<button onClick={onClose} className="text-xs text-flw-mute hover:text-flw-text">close</button>} />
      <div className="space-y-3 p-4 text-sm" data-testid="case-detail">
        <div className="flex flex-wrap gap-1.5"><Chip tone={d.status === "resolved" ? "lime" : d.status === "new" ? "amber" : "violet"}>{d.status.replace("_", " ")}</Chip>{d.urgent && <Chip tone="pink">urgent</Chip>}{d.caller_phone && <a className="font-mono text-xs text-flw-cyan" href={`tel:${d.caller_phone}`}>{d.caller_phone}</a>}</div>
        <p>{d.summary}</p>
        {d.reason && <p className="text-xs text-flw-mute">Why it came to a person: {d.reason}</p>}
        <label className="flex items-center gap-2 text-xs text-flw-mute"><UserRound size={13} /> Assigned to
          <select aria-label="Assign case" className={finputAuto} value={d.assigned_to ?? ""} onChange={(e) => void run(() => api(`${base}/cases/${id}/assign`, { method: "POST", body: { user_id: e.target.value || null } }), "Reassigned")}>
            <option value="">Nobody (back to the queue)</option>
            {team.map((m) => <option key={m.user_id} value={m.user_id}>{m.full_name} · {m.status}</option>)}
          </select>
        </label>
        <ol className="space-y-2 border-l border-flw-line pl-3" aria-label="Case notes">
          <li className="text-xs text-flw-mute">{fmtWhen(d.created_at)} · created{d.source === "ai_receptionist" ? " by the AI receptionist" : ""}</li>
          {d.notes?.map((n) => <li key={n.id} className="text-sm"><span className="text-xs text-flw-mute">{fmtWhen(n.created_at)} · {n.author_name ?? "someone"}</span><br />{n.body}</li>)}
          {d.resolution && <li className="text-sm text-flw-lime"><span className="text-xs text-flw-mute">{d.resolved_at && fmtWhen(d.resolved_at)} · resolved</span><br />{d.resolution}</li>}
        </ol>
        {d.status !== "resolved" ? (
          <>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (note.trim()) void run(async () => { await api(`${base}/cases/${id}/notes`, { method: "POST", body: { body: note } }); setNote(""); }); }}>
              <input aria-label="Add a note" className={finput} placeholder="Add a note (what you did, what they said)…" value={note} onChange={(e) => setNote(e.target.value)} />
              <FBtn type="submit" disabled={!note.trim()}>Add</FBtn>
            </form>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (resolution.trim()) void run(async () => { await api(`${base}/cases/${id}/resolve`, { method: "POST", body: { resolution } }); setResolution(""); }, "Resolved"); }}>
              <input aria-label="Resolution" className={finput} placeholder="How was it solved?" value={resolution} onChange={(e) => setResolution(e.target.value)} />
              <FBtn type="submit" variant="glow" disabled={!resolution.trim()}><Check size={13} /> Resolve</FBtn>
            </form>
          </>
        ) : <FBtn onClick={() => void run(() => api(`${base}/cases/${id}/reopen`, { method: "POST" }), "Reopened")}><RotateCcw size={13} /> Reopen</FBtn>}
      </div>
    </Glass>
  );
}

function Bookings({ base }: { base: string }) {
  const appts = usePolled<Appointment[]>(`${base}/appointments`);
  const services = useApi<Service[]>(`${base}/services`);
  const [open, setOpen] = useState(false);
  const [svc, setSvc] = useState("");
  const [day, setDay] = useState(() => new Date(Date.now() + 86400000).toISOString().slice(0, 10));
  const [slot, setSlot] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const slots = useApi<{ slots: string[] }>(open && svc ? `${base}/availability?service_id=${svc}&on=${day}` : null);
  const [moving, setMoving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const t = (iso: string) => new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const submit = async () => {
    setBusy(true);
    try {
      await api(`${base}/appointments`, { method: "POST", body: { service_id: svc, starts_at: slot, customer_name: name, customer_phone: phone } });
      setMsg({ kind: "ok", text: "Booked" }); setSlot(""); setName(""); setPhone(""); await Promise.all([appts.reload(), slots.reload()]);
    } catch (e) { setMsg({ kind: "error", text: e instanceof ApiError ? e.detail : "Booking failed" }); await slots.reload(); }
    finally { setBusy(false); }
  };
  return (
    <Glass>
      <GHead title="Upcoming bookings" right={<FBtn onClick={() => setOpen(!open)}><CalendarPlus size={13} /> New</FBtn>} />
      {open && (
        <form className="grid grid-cols-1 gap-2 border-b border-flw-line/70 p-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <select aria-label="Service" className={finput} value={svc} onChange={(e) => { setSvc(e.target.value); setSlot(""); }}><option value="">Choose a service…</option>{services.data?.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name} · {s.duration_min} min</option>)}</select>
          <input aria-label="Day" type="date" className={finput} value={day} onChange={(e) => { setDay(e.target.value); setSlot(""); }} />
          <select aria-label="Time" className={finput + " sm:col-span-2"} value={slot} onChange={(e) => setSlot(e.target.value)} disabled={!svc}>
            <option value="">{!svc ? "Pick a service first" : slots.data?.slots.length === 0 ? "No free times that day" : "Choose a time…"}</option>
            {slots.data?.slots.map((s) => <option key={s} value={s}>{t(s)}</option>)}
          </select>
          <input aria-label="Customer name" className={finput} placeholder="Customer name" value={name} onChange={(e) => setName(e.target.value)} />
          <input aria-label="Customer phone" className={finput} placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <FBtn type="submit" variant="glow" disabled={busy || !slot || !name || !phone} className="sm:col-span-2">{busy ? "Booking…" : "Book"}</FBtn>
        </form>
      )}
      {msg && <div className="px-4 py-2"><Notice kind={msg.kind}>{msg.text}</Notice></div>}
      <ul className="max-h-80 divide-y divide-flw-line/60 overflow-y-auto" data-testid="bookings">
        {appts.data?.length === 0 && <li className="p-4 text-sm text-flw-mute">No upcoming bookings.</li>}
        {appts.data?.map((a) => (
          <li key={a.id} data-testid={`booking-${a.id}`} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
            <div className="min-w-0 flex-1"><div className="truncate">{a.customer_name} · {a.service_name}</div><div className="font-mono text-[11px] text-flw-mute">{t(a.starts_at)} · {a.customer_phone}{a.source === "ai_receptionist" && " · booked by AI"}</div></div>
            {a.service_id && <button className="text-xs text-flw-cyan" onClick={() => setMoving(a.id)}>Reschedule</button>}
            <button disabled={busy} className="text-xs text-flw-mute hover:text-flw-pink" onClick={async () => {
              if (!window.confirm(`Cancel ${a.customer_name}'s ${a.service_name} appointment?`)) return;
              setBusy(true);
              try { await api(`${base}/appointments/${a.id}/cancel`, { method: "POST" }); setMsg({ kind: "ok", text: "Appointment cancelled" }); await appts.reload(); }
              catch (e) { setMsg({ kind: "error", text: e instanceof ApiError ? e.detail : "Cancellation failed. Try again." }); }
              finally { setBusy(false); }
            }}>cancel</button>
            {moving === a.id && <MoveBooking base={base} appointment={a} onClose={() => setMoving(null)} onMoved={async () => { setMoving(null); setMsg({ kind: "ok", text: "Appointment moved; booking reference kept" }); await appts.reload(); }} />}
          </li>
        ))}
      </ul>
    </Glass>
  );
}

function MoveBooking({ base, appointment, onClose, onMoved }: { base: string; appointment: Appointment; onClose: () => void; onMoved: () => Promise<void> }) {
  const [day, setDay] = useState("");
  const [slot, setSlot] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const settings = useApi<{ timezone: string }>(`${base}/settings`);
  useEffect(() => {
    if (!day && settings.data) setDay(new Intl.DateTimeFormat("en-CA", { timeZone: settings.data.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(appointment.starts_at)));
  }, [appointment.starts_at, day, settings.data]);
  const slots = useApi<{ slots: string[]; timezone: string }>(day ? `${base}/availability?service_id=${appointment.service_id}&on=${day}&appointment_id=${appointment.id}` : null);
  const submit = async () => {
    setBusy(true); setError(null);
    try { await api(`${base}/appointments/${appointment.id}/reschedule`, { method: "POST", body: { starts_at: slot } }); await onMoved(); }
    catch (e) { setError(e instanceof ApiError ? e.detail : "Could not confirm the move. Refresh bookings before retrying."); setSlot(""); await slots.reload(); }
    finally { setBusy(false); }
  };
  return (
    <form aria-label="Reschedule appointment" className="grid w-full gap-2 rounded-lg border border-flw-line p-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <p className="text-xs text-flw-mute">Original: {fmtWhen(appointment.starts_at)}. Times below use {slots.data?.timezone ?? "the business time zone"}.</p>
      <input aria-label="New day" type="date" required className={finput} value={day} onChange={(e) => { setDay(e.target.value); setSlot(""); setError(null); }} />
      <select aria-label="New time" className={finput} value={slot} onChange={(e) => setSlot(e.target.value)} disabled={busy || slots.loading}>
        <option value="">{slots.loading ? "Loading times…" : slots.data?.slots.length === 0 ? "No free times that day" : "Choose a new time…"}</option>
        {slots.data?.slots.map((s) => <option key={s} value={s}>{new Date(s).toLocaleString("en-GB", { timeZone: slots.data?.timezone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</option>)}
      </select>
      {(slots.error || settings.error) && <Notice kind="error">{(slots.error || settings.error)?.detail}</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
      <div className="flex flex-wrap gap-2"><FBtn type="submit" variant="glow" disabled={busy || !slot}>{busy ? "Moving…" : "Confirm move"}</FBtn><FBtn type="button" disabled={busy} onClick={onClose}>Keep original</FBtn></div>
    </form>
  );
}
