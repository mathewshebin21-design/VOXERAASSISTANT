// Call records from the VOXERA API (migration 0011): one row per call, with an ordered transcript.

export type CallStatus = "in_progress" | "completed" | "failed" | "abandoned";

export interface CallRecord {
  id: string;
  channel: "simulated" | "web" | "phone";
  status: CallStatus;
  outcome: string | null;
  caller_number: string | null;
  caller_name: string | null;
  ai_disclosure_played: boolean;
  recording_notice_played: boolean;
  transcript_retained: boolean;
  audio_stored: boolean;
  event_count: number;
  summary: { duration_ms?: number; caller_turns?: number; agent_turns?: number; tools?: Record<string, number>; errors?: number };
  started_at: string;
  ended_at: string | null;
}

export interface CallEvent {
  seq: number;
  at: string;
  kind: "utterance" | "tool" | "handoff" | "system" | "error";
  speaker: "caller" | "agent" | "system" | null;
  text: string | null;
  data: Record<string, unknown>;
}

export interface CallDetail extends CallRecord {
  events: CallEvent[];
}

export const STATUS_LABEL: Record<CallStatus, string> = {
  in_progress: "In progress",
  completed: "Completed",
  failed: "Failed",
  abandoned: "Abandoned",
};

export const CHANNEL_LABEL: Record<CallRecord["channel"], string> = {
  simulated: "Simulated",
  web: "Voice lab",
  phone: "Phone",
};

/** One line of the transcript, as a person reads it. Words withheld for consent say so. */
export function eventLine(e: CallEvent): { who: string; text: string; muted: boolean } {
  const who = e.speaker === "caller" ? "Caller" : e.speaker === "agent" ? "Receptionist" : "System";
  if (e.kind === "utterance") {
    if (e.text) return { who, text: e.text, muted: false };
    return { who, text: e.data.text_withheld ? "(words not kept: no recording notice was played)" : "(no words)", muted: true };
  }
  if (e.kind === "tool") return { who, text: `Used ${String(e.data.name ?? "a tool")}${e.data.ok === false ? " (failed)" : ""}`, muted: true };
  if (e.kind === "handoff") return { who, text: `Handed over (${String(e.data.outcome ?? "to the team")})`, muted: true };
  if (e.kind === "error") return { who, text: "Something went wrong on this turn", muted: true };
  return { who, text: e.text ?? "System note", muted: true };
}

export function durationLabel(ms: number | undefined): string {
  if (ms === undefined || ms < 0) return "—";
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}
