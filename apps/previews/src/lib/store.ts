"use client";

// Client-side preview state shared by all three designs: agent configuration,
// knowledge edits, version history and bookings made in the simulator.
// Persisted to localStorage only — no server, no accounts. Phase 2 replaces
// this with tenant-scoped API storage.

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { APPOINTMENTS, KNOWLEDGE, SERVICES } from "./demo-data";
import { DEFAULT_PERSONA, type AgentPersona } from "./simulator";
import type { Appointment, KnowledgeEntry } from "./types";
import { DEMO_TODAY } from "./time";

export interface EscalationRule {
  id: string;
  when: string;
  action: "transfer" | "message" | "urgent_alert";
  enabled: boolean;
}

export interface AgentConfig {
  persona: AgentPersona;
  voiceId: string;
  language: string;
  speakingRate: number; // 0.8–1.2
  enabledServiceIds: string[];
  escalation: EscalationRule[];
  afterHours: "answer_and_book" | "take_message" | "voicemail";
  retentionDays: number;
}

export interface ConfigVersion {
  version: number;
  publishedAt: string;
  note: string;
  config: AgentConfig;
}

interface PreviewState {
  draft: AgentConfig;
  published: ConfigVersion[];
  knowledge: KnowledgeEntry[];
  simBookings: Appointment[];
  wizardDone: boolean;
  setPersona: (p: Partial<AgentPersona>) => void;
  setDraft: (p: Partial<AgentConfig>) => void;
  publish: (note: string) => void;
  rollback: (version: number) => void;
  upsertKnowledge: (e: KnowledgeEntry) => void;
  removeKnowledge: (id: string) => void;
  addSimBookings: (a: Appointment[]) => void;
  completeWizard: (p: Partial<AgentConfig>) => void;
  reset: () => void;
}

export const DEFAULT_CONFIG: AgentConfig = {
  persona: DEFAULT_PERSONA,
  voiceId: "v-en-gb-warm",
  language: "English (UK)",
  speakingRate: 1,
  enabledServiceIds: SERVICES.filter((s) => s.bookableByAgent).map((s) => s.id),
  escalation: [
    { id: "esc-human", when: "Caller asks for a person", action: "transfer", enabled: true },
    { id: "esc-complaint", when: "Complaint or repeated frustration", action: "transfer", enabled: true },
    { id: "esc-urgent", when: "Possible reaction, injury or safety concern", action: "urgent_alert", enabled: true },
    { id: "esc-unknown", when: "Question not covered by verified knowledge", action: "message", enabled: true },
    { id: "esc-bridal", when: "Bridal / group bookings", action: "message", enabled: true },
  ],
  afterHours: "answer_and_book",
  retentionDays: 90,
};

const seedVersions = (): ConfigVersion[] => [
  { version: 3, publishedAt: "2026-09-11", note: "Added Thursday late opening", config: DEFAULT_CONFIG },
  { version: 4, publishedAt: "2026-10-05", note: "Patch-test rule for colour services", config: DEFAULT_CONFIG },
  { version: 5, publishedAt: "2026-10-17", note: "Warmer greeting; deposit questions deferred to team", config: DEFAULT_CONFIG },
];

export const usePreview = create<PreviewState>()(
  persist(
    (set, get) => ({
      draft: DEFAULT_CONFIG,
      published: seedVersions(),
      knowledge: KNOWLEDGE,
      simBookings: [],
      wizardDone: false,
      setPersona: (p) => set((s) => ({ draft: { ...s.draft, persona: { ...s.draft.persona, ...p } } })),
      setDraft: (p) => set((s) => ({ draft: { ...s.draft, ...p } })),
      publish: (note) => {
        const latest = get().published.at(-1)?.version ?? 0;
        set((s) => ({ published: [...s.published, { version: latest + 1, publishedAt: DEMO_TODAY, note: note || "Untitled change", config: s.draft }] }));
      },
      rollback: (version) => {
        const v = get().published.find((p) => p.version === version);
        if (!v) return;
        const latest = get().published.at(-1)!.version;
        set((s) => ({ draft: v.config, published: [...s.published, { version: latest + 1, publishedAt: DEMO_TODAY, note: `Rollback to v${version}`, config: v.config }] }));
      },
      upsertKnowledge: (e) =>
        set((s) => {
          const exists = s.knowledge.some((k) => k.id === e.id);
          return { knowledge: exists ? s.knowledge.map((k) => (k.id === e.id ? e : k)) : [...s.knowledge, e] };
        }),
      removeKnowledge: (id) => set((s) => ({ knowledge: s.knowledge.filter((k) => k.id !== id) })),
      addSimBookings: (a) => set((s) => ({ simBookings: [...s.simBookings, ...a.filter((x) => !s.simBookings.some((y) => y.id === x.id))] })),
      completeWizard: (p) => set((s) => ({ wizardDone: true, draft: { ...s.draft, ...p } })),
      reset: () => set({ draft: DEFAULT_CONFIG, published: seedVersions(), knowledge: KNOWLEDGE, simBookings: [], wizardDone: false }),
    }),
    { name: "voxera-preview-v1", storage: createJSONStorage(() => localStorage), skipHydration: true },
  ),
);

/** All appointments visible in calendars: demo diary + anything booked in the simulator. */
export function useAllAppointments(): Appointment[] {
  const sim = usePreview((s) => s.simBookings);
  return sim.length ? [...APPOINTMENTS, ...sim] : APPOINTMENTS;
}
