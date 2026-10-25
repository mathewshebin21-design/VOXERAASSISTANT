// Synthetic demo dataset. "Halden & Rye" is a fictional Bristol hair studio.
// Every name, number and record below is generated — nothing comes from a real
// business, real caller or a live telephony provider.

import { mulberry32, pick, weighted } from "./rng";
import { simulatedCallCostGBP } from "./pricing";
import { DEMO_NOW_MIN, DEMO_TODAY, addDays, dow } from "./time";
import type {
  Appointment, Business, CallOutcome, CallRecord, Integration, Intent, KnowledgeEntry,
  Sentiment, Service, Staff, TeamMember, TranscriptTurn,
} from "./types";

export const DEMO_LABEL = "Demo data — synthetic records, no live calls";

export const BUSINESS: Business = {
  name: "Halden & Rye",
  tagline: "Hair studio · Clifton, Bristol",
  sector: "Hair & beauty",
  city: "Bristol",
  address: "14 Regent Arcade, Clifton, Bristol BS8 4AA (fictional)",
  phoneDisplay: "0117 000 0000 (demo)",
  timezone: "Europe/London",
  hours: {
    0: null,
    1: null,
    2: [9 * 60, 18 * 60],
    3: [9 * 60, 18 * 60],
    4: [9 * 60, 20 * 60],
    5: [9 * 60, 18 * 60],
    6: [8 * 60 + 30, 17 * 60],
  },
};

export const SERVICES: Service[] = [
  { id: "svc-cut-w", name: "Restyle cut & finish", category: "Cut", durationMin: 60, bufferMin: 10, priceFromGBP: 58, bookableByAgent: true },
  { id: "svc-cut-m", name: "Short cut", category: "Cut", durationMin: 30, bufferMin: 5, priceFromGBP: 32, bookableByAgent: true },
  { id: "svc-blow", name: "Blow-dry", category: "Styling", durationMin: 45, bufferMin: 5, priceFromGBP: 34, bookableByAgent: true },
  { id: "svc-tint", name: "Full colour", category: "Colour", durationMin: 120, bufferMin: 15, priceFromGBP: 95, requiresPatchTest: true, bookableByAgent: true },
  { id: "svc-balay", name: "Balayage", category: "Colour", durationMin: 180, bufferMin: 15, priceFromGBP: 165, requiresPatchTest: true, bookableByAgent: true },
  { id: "svc-gloss", name: "Gloss & tone", category: "Colour", durationMin: 45, bufferMin: 10, priceFromGBP: 48, requiresPatchTest: true, bookableByAgent: true },
  { id: "svc-treat", name: "Bond repair treatment", category: "Treatment", durationMin: 30, bufferMin: 5, priceFromGBP: 40, bookableByAgent: true },
  { id: "svc-consult", name: "Colour consultation & patch test", category: "Consultation", durationMin: 15, bufferMin: 0, priceFromGBP: 0, bookableByAgent: true },
  { id: "svc-bridal", name: "Bridal styling", category: "Styling", durationMin: 90, bufferMin: 15, priceFromGBP: 120, bookableByAgent: false },
];

const WEEK: Staff["hours"] = { 0: null, 1: null, 2: [540, 1080], 3: [540, 1080], 4: [540, 1200], 5: [540, 1080], 6: [510, 1020] };

export const STAFF: Staff[] = [
  { id: "stf-ada", name: "Ada Okafor", role: "Creative director", initials: "AO", serviceIds: SERVICES.map((s) => s.id), hours: WEEK },
  { id: "stf-tom", name: "Tomasz Wren", role: "Senior stylist", initials: "TW", serviceIds: ["svc-cut-w", "svc-cut-m", "svc-blow", "svc-treat", "svc-consult", "svc-bridal"], hours: { ...WEEK, 3: null } },
  { id: "stf-isla", name: "Isla Marsh", role: "Colourist", initials: "IM", serviceIds: ["svc-tint", "svc-balay", "svc-gloss", "svc-consult", "svc-treat"], hours: { ...WEEK, 6: null } },
  { id: "stf-ben", name: "Ben Adeyemi", role: "Stylist", initials: "BA", serviceIds: ["svc-cut-w", "svc-cut-m", "svc-blow", "svc-treat"], hours: { ...WEEK, 2: null, 4: [720, 1200] } },
];

export const serviceById = (id: string) => SERVICES.find((s) => s.id === id)!;
export const staffById = (id: string) => STAFF.find((s) => s.id === id)!;

const FIRST = ["Amelia", "Priya", "Olivia", "Grace", "Hannah", "Sophie", "Freya", "Leah", "Zara", "Chloe", "Isabel", "Maya", "Ruth", "Jas", "Ellie", "Nadia", "Kemi", "Rosa", "Lucy", "Aisha", "James", "Oliver", "Sam", "Daniel", "Marcus", "Theo", "Rhys", "Callum", "Arjun", "Femi"];
const LAST = ["Hughes", "Patel", "Clarke", "Evans", "Shah", "Morgan", "Bennett", "Khan", "Lloyd", "Price", "Turner", "Begum", "Walsh", "Ahmed", "Fraser", "Doyle", "Mensah", "Novak", "Reid", "Singh"];

function maskedNumber(r: () => number) {
  return `+44 7••• •••${Math.floor(r() * 900 + 100)}`;
}

const OUTCOME_FOR_INTENT: Record<Intent, Partial<Record<CallOutcome, number>>> = {
  booking: { booked: 66, transferred: 8, message_taken: 10, abandoned: 9, failed: 7 },
  reschedule: { rescheduled: 74, transferred: 8, message_taken: 10, failed: 8 },
  cancellation: { cancelled: 85, message_taken: 10, abandoned: 5 },
  pricing: { answered_question: 70, booked: 20, abandoned: 10 },
  hours_location: { answered_question: 92, abandoned: 8 },
  policy: { answered_question: 70, transferred: 20, message_taken: 10 },
  complaint: { transferred: 70, message_taken: 30 },
  other: { answered_question: 40, message_taken: 30, transferred: 20, failed: 10 },
};

const SUMMARY: Record<CallOutcome, (n: string, s: string) => string> = {
  booked: (n, s) => `${n} booked a ${s.toLowerCase()} after checking availability and confirming the slot.`,
  rescheduled: (n, s) => `${n} moved their ${s.toLowerCase()} to a new time; confirmation sent.`,
  cancelled: (n, s) => `${n} cancelled their ${s.toLowerCase()} within the 24h policy window.`,
  answered_question: (n) => `${n} asked about prices or opening hours; answered from verified knowledge.`,
  transferred: (n) => `${n} asked for a team member; warm transfer to the front desk.`,
  message_taken: (n) => `${n} left a message for a callback; details captured for the team.`,
  abandoned: (n) => `${n} hung up before completing the enquiry.`,
  failed: (n) => `Conversation with ${n} could not be completed — flagged for review.`,
  no_answer: (n) => `Missed call from ${n}; out-of-hours voicemail offered.`,
};

function generate() {
  const r = mulberry32(20261023);
  const calls: CallRecord[] = [];
  const appts: Appointment[] = [];
  let callSeq = 1, apptSeq = 1;

  for (let back = 41; back >= -13; back--) {
    const date = addDays(DEMO_TODAY, -back);
    const wd = dow(date);
    const open = BUSINESS.hours[wd];

    // Front-desk / online bookings fill the diary so availability is realistic.
    if (open) {
      for (const st of STAFF) {
        const h = st.hours[wd];
        if (!h) continue;
        let t = h[0] + (r() < 0.5 ? 0 : 30);
        while (t < h[1] - 30) {
          if (r() < 0.36) { t += 30; continue; }
          const svc = pick(r, SERVICES.filter((s) => st.serviceIds.includes(s.id) && s.durationMin <= h[1] - t));
          if (!svc) break;
          const past = back > 0 || (back === 0 && t + svc.durationMin <= DEMO_NOW_MIN);
          appts.push({
            id: `apt-${String(apptSeq++).padStart(4, "0")}`,
            serviceId: svc.id, staffId: st.id, date, startMin: t, durationMin: svc.durationMin,
            customerName: `${pick(r, FIRST)} ${pick(r, LAST)}`,
            status: past ? (r() < 0.05 ? "no_show" : "completed") : r() < 0.04 ? "cancelled" : "confirmed",
            bookedVia: r() < 0.6 ? "online" : "front_desk",
          });
          t += svc.durationMin + svc.bufferMin;
          t = Math.ceil(t / 15) * 15;
        }
      }
    }

    if (back < 0) continue; // calls only for past days and today
    const n = open ? Math.floor(r() * 9) + 6 : Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      const timeMin = open
        ? Math.floor(open[0] - 60 + r() * (open[1] - open[0] + 180))
        : Math.floor(600 + r() * 480);
      if (back === 0 && timeMin > DEMO_NOW_MIN) continue;
      const name = `${pick(r, FIRST)} ${pick(r, LAST)}`;
      const intent = weighted<Intent>(r, { booking: 38, reschedule: 12, cancellation: 8, pricing: 14, hours_location: 12, policy: 6, complaint: 3, other: 7 });
      // The agent answers 24/7, but a small share of calls drop before pickup
      // or route to voicemail during simulated provider incidents.
      const status = r() < 0.035 ? "missed" : r() < 0.02 ? "voicemail" : "answered";
      const outcome: CallOutcome = status === "answered" ? weighted(r, OUTCOME_FOR_INTENT[intent] as Record<CallOutcome, number>) : status === "voicemail" ? "message_taken" : "no_answer";
      const durationSec = status === "missed" ? 0 : outcome === "abandoned" ? Math.floor(20 + r() * 60) : Math.floor(70 + r() * 260);
      const sentiment: Sentiment = intent === "complaint" || outcome === "failed" ? "negative" : r() < 0.62 ? "positive" : r() < 0.85 ? "neutral" : "negative";
      const svc = pick(r, SERVICES.filter((s) => s.bookableByAgent));
      const call: CallRecord = {
        id: `call-${String(callSeq++).padStart(4, "0")}`,
        source: "demo",
        date, timeMin, durationSec,
        callerName: name,
        callerNumberMasked: maskedNumber(r),
        status, outcome, intent, sentiment,
        latencyMsP50: status === "missed" ? 0 : Math.round(620 + r() * 380 + (r() < 0.06 ? 500 : 0)),
        costGBP: simulatedCallCostGBP(durationSec),
        summary: SUMMARY[outcome](name.split(" ")[0], svc.name),
        agentVersion: back > 18 ? 3 : back > 6 ? 4 : 5,
        tags: [],
      };
      if (!open) call.tags.push("out-of-hours");
      if (call.latencyMsP50 > 1100) call.tags.push("slow-turns");
      if (outcome === "booked" || outcome === "rescheduled") {
        // Voice bookings land in the coming 1–12 days on a staff member's free slot.
        const target = addDays(date, 1 + Math.floor(r() * 12));
        const st = pick(r, STAFF.filter((s) => s.serviceIds.includes(svc.id) && s.hours[dow(target)]));
        const h = st?.hours[dow(target)];
        if (st && h) {
          const start = Math.floor((h[0] + r() * Math.max(0, h[1] - h[0] - svc.durationMin)) / 15) * 15;
          const apptPast = target < DEMO_TODAY || (target === DEMO_TODAY && start + svc.durationMin <= DEMO_NOW_MIN);
          const a: Appointment = {
            id: `apt-${String(apptSeq++).padStart(4, "0")}`,
            serviceId: svc.id, staffId: st.id, date: target, startMin: start, durationMin: svc.durationMin,
            customerName: name, status: apptPast ? (r() < 0.06 ? "no_show" : "completed") : "confirmed",
            bookedVia: "voice_agent", callId: call.id,
          };
          appts.push(a);
          call.appointmentId = a.id;
        }
      }
      calls.push(call);
    }
  }
  calls.sort((a, b) => (a.date === b.date ? b.timeMin - a.timeMin : a.date < b.date ? 1 : -1));
  return { calls, appts };
}

const generated = generate();
export const CALLS: CallRecord[] = generated.calls;
export const APPOINTMENTS: Appointment[] = generated.appts;
export const callById = (id: string) => CALLS.find((c) => c.id === id);

export const KNOWLEDGE: KnowledgeEntry[] = [
  { id: "kb-about", category: "About", title: "About the studio", body: "Halden & Rye is an independent hair studio in Clifton, Bristol, with four stylists. We specialise in lived-in colour and precision cutting.", source: "Owner-written", updatedAt: "2026-10-02", version: 3, status: "verified" },
  { id: "kb-hours", category: "Hours & location", title: "Opening hours", body: "Tuesday, Wednesday and Friday 9:00–18:00. Thursday late opening 9:00–20:00. Saturday 8:30–17:00. Closed Sunday and Monday.", source: "Workspace settings", updatedAt: "2026-09-14", version: 5, status: "verified" },
  { id: "kb-location", category: "Hours & location", title: "Finding us & parking", body: "We are inside Regent Arcade, Clifton. The nearest car park is Clifton Village pay & display, about 4 minutes' walk. There is step-free access via the arcade's rear entrance.", source: "Owner-written", updatedAt: "2026-08-30", version: 2, status: "verified" },
  { id: "kb-prices", category: "Services & pricing", title: "Price list", body: "Prices are 'from' prices and depend on hair length and stylist level. Restyle cut & finish from £58, short cut from £32, blow-dry from £34, full colour from £95, balayage from £165, gloss & tone from £48, bond repair from £40. Consultations are free.", source: "price-list-autumn-2026.pdf · p.1", updatedAt: "2026-10-01", version: 7, status: "verified" },
  { id: "kb-patch", category: "Policies", title: "Patch tests", body: "Any colour service needs a patch test at least 48 hours before the appointment, unless a test has been done with us in the last 6 months. Patch tests are free and take about 10 minutes.", source: "Salon policy handbook §2", updatedAt: "2026-07-11", version: 2, status: "verified" },
  { id: "kb-cancel", category: "Policies", title: "Cancellation policy", body: "Please give at least 24 hours' notice to cancel or move an appointment. Late cancellations and no-shows may be charged 50% of the booked service.", source: "Salon policy handbook §4", updatedAt: "2026-07-11", version: 2, status: "verified" },
  { id: "kb-deposit", category: "Policies", title: "Deposits for long colour appointments", body: "Balayage appointments require a £30 deposit taken by the team after booking.", source: "Website — /booking (crawled 2026-09-20)", updatedAt: "2026-09-20", version: 1, status: "conflict", conflictNote: "Policy handbook §4 (July) says £25. Confirm the current figure before the agent quotes a deposit." },
  { id: "kb-deposit-handbook", category: "Policies", title: "Deposits (policy handbook)", body: "A £25 deposit is taken for balayage appointments.", source: "Salon policy handbook §4", updatedAt: "2026-07-11", version: 2, status: "conflict", conflictNote: "Website /booking (September) says £30. Confirm the current figure before the agent quotes a deposit." },
  { id: "kb-kids", category: "FAQ", title: "Children's cuts", body: "We cut children's hair from age 8 at short-cut prices on weekday mornings.", source: "Owner-written", updatedAt: "2026-06-03", version: 1, status: "needs_review" },
  { id: "kb-products", category: "FAQ", title: "Retail products", body: "We stock a small range of professional aftercare products in the studio. We don't ship orders.", source: "Owner-written", updatedAt: "2026-05-19", version: 1, status: "verified" },
];

export const INTEGRATIONS: Integration[] = [
  { id: "gcal", name: "Google Calendar", category: "Calendar", description: "Two-way availability and booking sync per stylist calendar.", status: "connected", auth: "OAuth 2.0", scopes: ["calendar.events", "calendar.freebusy"] },
  { id: "m365", name: "Microsoft 365 / Outlook", category: "Calendar", description: "Free/busy lookups and event creation via Microsoft Graph.", status: "available", auth: "OAuth 2.0" },
  { id: "twilio", name: "Twilio Voice", category: "Telephony", description: "UK numbers, inbound call answering, transfers, signed webhooks. Not connected in preview.", status: "available", auth: "Signed webhook" },
  { id: "sip", name: "SIP trunk (BYO carrier)", category: "Telephony", description: "Bring an existing number via SIP (e.g. Telnyx).", status: "planned", auth: "SIP" },
  { id: "hubspot", name: "HubSpot", category: "CRM", description: "Create/update contacts, log calls and appointments to the timeline.", status: "available", auth: "OAuth 2.0" },
  { id: "salesforce", name: "Salesforce", category: "CRM", description: "Leads, contacts and activity logging.", status: "planned", auth: "OAuth 2.0" },
  { id: "revora", name: "REVORA AI", category: "Voxera suite", description: "Push qualified leads into REVORA pipelines.", status: "planned", auth: "Internal" },
  { id: "orchestra", name: "ORCHESTRA AI", category: "Voxera suite", description: "Trigger approved follow-up workflows after a call.", status: "planned", auth: "Internal" },
  { id: "sms", name: "SMS confirmations", category: "Messaging", description: "Booking confirmations and reminders via the telephony provider.", status: "available", auth: "API key" },
  { id: "email", name: "Email notifications", category: "Messaging", description: "Message-taken alerts and daily digests to the team.", status: "connected", auth: "API key" },
  { id: "webhooks", name: "Outbound webhooks", category: "Automation", description: "HMAC-signed events: call.completed, appointment.created …", status: "connected", auth: "Signed webhook" },
];

export const TEAM: TeamMember[] = [
  { id: "u1", name: "Ada Okafor", email: "ada@halden-rye.example", role: "Owner", lastActive: "Today" },
  { id: "u2", name: "Mia Castell", email: "mia@halden-rye.example", role: "Manager", lastActive: "Today" },
  { id: "u3", name: "Tomasz Wren", email: "tomasz@halden-rye.example", role: "Viewer", lastActive: "Yesterday" },
  { id: "u4", name: "Accounts (external)", email: "books@ledgerline.example", role: "Viewer", lastActive: "12 Oct" },
];

// Hand-written transcripts for a few calls; the rest are composed from templates.
const SCRIPTED: Record<string, (c: CallRecord) => TranscriptTurn[]> = {
  booked: (c) => [
    { at: 0, speaker: "system", text: "Call answered by AI receptionist (v" + c.agentVersion + "). Recording disclosure played." },
    { at: 1, speaker: "agent", text: "Hi, you're through to Halden & Rye. I'm Rye, the studio's AI receptionist — this call may be recorded for quality. How can I help?" },
    { at: 7, speaker: "caller", text: "Hiya, I'd like to book a cut, ideally next week… um, Thursday evening if you've got anything?" },
    { at: 13, speaker: "agent", text: "Of course. Is that a restyle cut and finish, or a shorter trim?" },
    { at: 17, speaker: "caller", text: "Restyle, please. It's quite long." },
    { at: 19, speaker: "tool", text: "Checking availability", tool: { name: "check_availability", args: { service: "svc-cut-w", day: "Thursday", window: "after 17:00" }, result: "2 slots: 17:30 Ben Adeyemi, 18:15 Ada Okafor", ok: true } },
    { at: 21, speaker: "agent", text: "Thursday evening I have 5:30 with Ben, or 6:15 with Ada. Restyles start from £58 depending on length. Would either of those work?" },
    { at: 28, speaker: "caller", text: "Oh — sorry, actually could it be — 6:15 with Ada?", interrupted: false },
    { at: 31, speaker: "agent", text: "Lovely. Just to confirm: restyle cut and finish, Thursday at 6:15pm with Ada. Can I take your name?" },
    { at: 36, speaker: "caller", text: `It's ${c.callerName}.` },
    { at: 38, speaker: "agent", text: `Thanks, ${c.callerName.split(" ")[0]}. Shall I go ahead and book that?` },
    { at: 41, speaker: "caller", text: "Yes please." },
    { at: 42, speaker: "tool", text: "Creating booking", tool: { name: "create_booking", args: { service: "svc-cut-w", staff: "stf-ada", start: "Thu 18:15", customer: c.callerName, confirmed_by_caller: true, idempotency_key: c.id }, result: "Booked · " + (c.appointmentId ?? "apt-xxxx"), ok: true } },
    { at: 44, speaker: "agent", text: "You're booked in. You'll get a text confirmation shortly. Anything else I can help with?" },
    { at: 48, speaker: "caller", text: "No that's great, thanks!" },
    { at: 50, speaker: "agent", text: "Thanks for calling Halden & Rye — see you Thursday." },
  ],
  transferred: (c) => [
    { at: 0, speaker: "system", text: "Call answered by AI receptionist. Recording disclosure played." },
    { at: 1, speaker: "agent", text: "Hi, you're through to Halden & Rye. I'm Rye, the studio's AI receptionist. How can I help?" },
    { at: 6, speaker: "caller", text: "I was in on Saturday and honestly I'm not happy with my colour. I want to speak to someone." },
    { at: 12, speaker: "agent", text: "I'm really sorry to hear that. I'll get you to a member of the team now — they'll be able to help properly. Is that okay?" },
    { at: 18, speaker: "caller", text: "Yes." },
    { at: 19, speaker: "tool", text: "Warm transfer", tool: { name: "transfer_call", args: { destination: "front_desk", reason: "complaint_colour", summary: "Unhappy with Saturday colour service, wants to speak to a person" }, result: "Front desk answered after 9s · context handed over", ok: true } },
    { at: 29, speaker: "system", text: `Call transferred to front desk. ${c.callerName.split(" ")[0]}'s summary shared with the team member.` },
  ],
  failed: () => [
    { at: 0, speaker: "system", text: "Call answered by AI receptionist. Recording disclosure played." },
    { at: 1, speaker: "agent", text: "Hi, you're through to Halden & Rye. I'm Rye, the studio's AI receptionist. How can I help?" },
    { at: 6, speaker: "caller", text: "[unclear — high background noise] …the thing for my sister… Saturday…" },
    { at: 11, speaker: "agent", text: "Sorry, it's a little noisy — did you want to book an appointment for your sister on Saturday?" },
    { at: 16, speaker: "caller", text: "[unclear]" },
    { at: 19, speaker: "tool", text: "Checking availability", tool: { name: "check_availability", args: { day: "Saturday" }, result: "Calendar provider timeout after 3000ms", ok: false } },
    { at: 23, speaker: "agent", text: "I'm sorry, I'm having trouble checking the diary right now. Can I take a number so the team can call you back today?" },
    { at: 29, speaker: "system", text: "Caller disconnected. Flagged for review: noise + tool timeout." },
  ],
};

const GENERIC: Record<string, (c: CallRecord) => TranscriptTurn[]> = {
  answered_question: (c) => [
    { at: 0, speaker: "system", text: "Call answered by AI receptionist. Recording disclosure played." },
    { at: 1, speaker: "agent", text: "Hi, you're through to Halden & Rye. I'm Rye, the studio's AI receptionist. How can I help?" },
    { at: 5, speaker: "caller", text: c.intent === "pricing" ? "How much is balayage roughly?" : "What time are you open till on Thursday?" },
    { at: 8, speaker: "tool", text: "Knowledge lookup", tool: { name: "search_knowledge", args: { query: c.intent === "pricing" ? "balayage price" : "thursday opening hours" }, result: c.intent === "pricing" ? "kb-prices v7 (score 0.91)" : "kb-hours v5 (score 0.94)", ok: true } },
    { at: 9, speaker: "agent", text: c.intent === "pricing" ? "Balayage starts from £165 — the final price depends on length and thickness. It also needs a free patch test 48 hours before. Would you like me to find a time?" : "On Thursdays we're open late, until 8pm. Is there anything I can book for you?" },
    { at: 18, speaker: "caller", text: "Not right now, thanks." },
    { at: 20, speaker: "agent", text: "No problem — thanks for calling Halden & Rye." },
  ],
  message_taken: (c) => [
    { at: 0, speaker: "system", text: c.status === "voicemail" ? "Voicemail fallback — agent unavailable." : "Call answered by AI receptionist. Recording disclosure played." },
    { at: 1, speaker: "agent", text: "Hi, you're through to Halden & Rye. I'm Rye, the studio's AI receptionist. How can I help?" },
    { at: 5, speaker: "caller", text: "Could someone call me back about a bridal trial?" },
    { at: 9, speaker: "agent", text: "Bridal styling is arranged directly with the team, so I'll take a message. What's the best number to reach you?" },
    { at: 15, speaker: "caller", text: "This one's fine." },
    { at: 17, speaker: "tool", text: "Take message", tool: { name: "take_message", args: { topic: "bridal_trial", callback: c.callerNumberMasked }, result: "Message queued · team notified by email", ok: true } },
    { at: 18, speaker: "agent", text: "Thanks — I've passed that on and someone will call you back within one working day." },
  ],
  rescheduled: (c) => [
    { at: 0, speaker: "system", text: "Call answered by AI receptionist. Recording disclosure played." },
    { at: 1, speaker: "agent", text: "Hi, you're through to Halden & Rye. I'm Rye, the studio's AI receptionist. How can I help?" },
    { at: 5, speaker: "caller", text: "I need to move my appointment, something's come up." },
    { at: 8, speaker: "tool", text: "Find booking", tool: { name: "find_booking", args: { caller_number: c.callerNumberMasked }, result: "1 upcoming booking found", ok: true } },
    { at: 9, speaker: "agent", text: `I can see your booking, ${c.callerName.split(" ")[0]}. When would suit you instead?` },
    { at: 14, speaker: "caller", text: "Same time next week if possible?" },
    { at: 16, speaker: "tool", text: "Checking availability", tool: { name: "check_availability", args: { same_staff: true, week_offset: 1 }, result: "Slot available", ok: true } },
    { at: 17, speaker: "agent", text: "That's free with the same stylist. Shall I move it?" },
    { at: 20, speaker: "caller", text: "Yes please." },
    { at: 21, speaker: "tool", text: "Reschedule", tool: { name: "reschedule_booking", args: { confirmed_by_caller: true, idempotency_key: c.id }, result: "Moved · confirmation SMS queued", ok: true } },
    { at: 23, speaker: "agent", text: "Done — you'll get a new confirmation by text. Anything else?" },
  ],
  cancelled: (c) => [
    { at: 0, speaker: "system", text: "Call answered by AI receptionist. Recording disclosure played." },
    { at: 1, speaker: "agent", text: "Hi, you're through to Halden & Rye. I'm Rye, the studio's AI receptionist. How can I help?" },
    { at: 5, speaker: "caller", text: "I'm afraid I need to cancel my appointment." },
    { at: 8, speaker: "tool", text: "Find booking", tool: { name: "find_booking", args: { caller_number: c.callerNumberMasked }, result: "1 upcoming booking found (in 3 days)", ok: true } },
    { at: 9, speaker: "agent", text: "I've found it. As it's more than 24 hours away there's no charge. Would you like to rebook for another time, or just cancel?" },
    { at: 15, speaker: "caller", text: "Just cancel for now, thanks." },
    { at: 16, speaker: "tool", text: "Cancel", tool: { name: "cancel_booking", args: { confirmed_by_caller: true, idempotency_key: c.id }, result: "Cancelled", ok: true } },
    { at: 17, speaker: "agent", text: "That's cancelled. Thanks for letting us know." },
  ],
  abandoned: () => [
    { at: 0, speaker: "system", text: "Call answered by AI receptionist. Recording disclosure played." },
    { at: 1, speaker: "agent", text: "Hi, you're through to Halden & Rye. I'm Rye, the studio's AI receptionist. How can I help?" },
    { at: 6, speaker: "caller", text: "Oh — it's a robot. Never mind." },
    { at: 8, speaker: "agent", text: "I can put you through to a person if you prefer—", interrupted: true },
    { at: 9, speaker: "system", text: "Caller disconnected." },
  ],
};

export function transcriptFor(c: CallRecord): TranscriptTurn[] {
  if (c.status === "missed") return [{ at: 0, speaker: "system", text: "Caller hung up before the agent answered (ring time 4s)." }];
  const f = SCRIPTED[c.outcome] ?? GENERIC[c.outcome] ?? GENERIC.answered_question;
  return f(c);
}
