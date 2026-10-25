// Domain types shared by all three design previews. These mirror the shapes the
// Phase 2+ backend is expected to expose, but every record here is synthetic.

export type DataSource = "demo";

export interface Service {
  id: string;
  name: string;
  category: "Cut" | "Colour" | "Treatment" | "Styling" | "Consultation";
  durationMin: number;
  bufferMin: number;
  priceFromGBP: number;
  /** Some services need a patch test 48h before — a business rule the agent must respect. */
  requiresPatchTest?: boolean;
  bookableByAgent: boolean;
}

export interface Staff {
  id: string;
  name: string;
  role: string;
  initials: string;
  serviceIds: string[];
  /** Working hours per weekday (0 = Sun). null = not working. */
  hours: Record<number, [number, number] | null>;
}

export interface OpeningHours {
  /** 0 = Sun. null = closed. Minutes from midnight. */
  [weekday: number]: [number, number] | null;
}

export interface Business {
  name: string;
  tagline: string;
  sector: string;
  city: string;
  address: string;
  phoneDisplay: string;
  timezone: string;
  hours: OpeningHours;
}

export type CallStatus = "answered" | "missed" | "voicemail";
export type CallOutcome =
  | "booked"
  | "rescheduled"
  | "cancelled"
  | "answered_question"
  | "transferred"
  | "message_taken"
  | "abandoned"
  | "failed"
  | "no_answer";
export type Intent = "booking" | "reschedule" | "cancellation" | "pricing" | "hours_location" | "policy" | "complaint" | "other";
export type Sentiment = "positive" | "neutral" | "negative";

export interface CallRecord {
  id: string;
  source: DataSource;
  date: string; // YYYY-MM-DD
  timeMin: number;
  durationSec: number;
  callerName: string;
  callerNumberMasked: string;
  status: CallStatus;
  outcome: CallOutcome;
  intent: Intent;
  sentiment: Sentiment;
  /** Simulated per-call median voice-to-voice latency in ms. Not a measurement. */
  latencyMsP50: number;
  /** Simulated cost in GBP using the assumption table in lib/pricing.ts. */
  costGBP: number;
  appointmentId?: string;
  summary: string;
  agentVersion: number;
  tags: string[];
}

export type TurnSpeaker = "agent" | "caller" | "tool" | "system";

export interface TranscriptTurn {
  at: number; // seconds from call start
  speaker: TurnSpeaker;
  text: string;
  tool?: { name: string; args: Record<string, unknown>; result: string; ok: boolean };
  interrupted?: boolean;
}

export type AppointmentStatus = "confirmed" | "completed" | "cancelled" | "no_show";

export interface Appointment {
  id: string;
  serviceId: string;
  staffId: string;
  date: string;
  startMin: number;
  durationMin: number;
  customerName: string;
  status: AppointmentStatus;
  bookedVia: "voice_agent" | "front_desk" | "online";
  callId?: string;
}

export type KnowledgeStatus = "verified" | "needs_review" | "conflict";

export interface KnowledgeEntry {
  id: string;
  category: "About" | "Services & pricing" | "Hours & location" | "Policies" | "FAQ";
  title: string;
  body: string;
  source: string;
  updatedAt: string;
  version: number;
  status: KnowledgeStatus;
  conflictNote?: string;
}

export type IntegrationStatus = "connected" | "available" | "planned";

export interface Integration {
  id: string;
  name: string;
  category: "Calendar" | "CRM" | "Messaging" | "Telephony" | "Automation" | "Voxera suite";
  description: string;
  status: IntegrationStatus;
  auth: "OAuth 2.0" | "API key" | "Signed webhook" | "SIP" | "Internal";
  scopes?: string[];
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: "Owner" | "Admin" | "Manager" | "Viewer";
  lastActive: string;
}
