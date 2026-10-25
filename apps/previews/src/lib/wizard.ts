"use client";

import { useState } from "react";
import { BUSINESS, SERVICES } from "./demo-data";
import { DEFAULT_CONFIG, usePreview } from "./store";
import type { OpeningHours } from "./types";

export const WIZARD_STEPS = [
  { id: "business", title: "Business", blurb: "Who the receptionist works for." },
  { id: "services", title: "Services", blurb: "What callers can book." },
  { id: "hours", title: "Hours", blurb: "When you're open and what happens after hours." },
  { id: "voice", title: "Voice & personality", blurb: "How the receptionist sounds." },
  { id: "knowledge", title: "Knowledge", blurb: "Verified facts it may share." },
  { id: "safety", title: "Escalation & consent", blurb: "When to hand over and what callers are told." },
  { id: "review", title: "Review", blurb: "Check and test before going live." },
] as const;

export type WizardStepId = (typeof WIZARD_STEPS)[number]["id"];

export interface WizardDraft {
  businessName: string;
  sector: string;
  website: string;
  agentName: string;
  serviceIds: string[];
  hours: OpeningHours;
  afterHours: "answer_and_book" | "take_message" | "voicemail";
  voiceId: string;
  warmth: number;
  verbosity: number;
  greeting: string;
  importWebsite: boolean;
  faqs: string;
  transferNumber: string;
  recordingDisclosure: boolean;
  urgentAlerts: boolean;
}

export function useWizard() {
  const completeWizard = usePreview((s) => s.completeWizard);
  const draftCfg = usePreview((s) => s.draft);
  const [step, setStep] = useState(0);
  const [d, setD] = useState<WizardDraft>({
    businessName: BUSINESS.name,
    sector: BUSINESS.sector,
    website: "https://halden-rye.example",
    agentName: draftCfg.persona.agentName,
    serviceIds: SERVICES.filter((s) => s.bookableByAgent).map((s) => s.id),
    hours: BUSINESS.hours,
    afterHours: "answer_and_book",
    voiceId: draftCfg.voiceId,
    warmth: draftCfg.persona.warmth,
    verbosity: draftCfg.persona.verbosity,
    greeting: draftCfg.persona.greeting,
    importWebsite: true,
    faqs: "Do you cut children's hair?\nIs there parking nearby?",
    transferNumber: "+44 117 000 0001 (demo)",
    recordingDisclosure: true,
    urgentAlerts: true,
  });
  const set = (p: Partial<WizardDraft>) => setD((x) => ({ ...x, ...p }));

  const errors: Partial<Record<WizardStepId, string>> = {};
  if (!d.businessName.trim()) errors.business = "Business name is required.";
  if (!d.agentName.trim()) errors.business = "Give your receptionist a name.";
  if (!d.serviceIds.length) errors.services = "Choose at least one bookable service.";
  if (!d.greeting.trim()) errors.voice = "Add a greeting.";
  else if (!/\bAI\b|virtual assistant|automated/i.test(d.greeting)) errors.voice = "The greeting must tell callers they are speaking to an AI receptionist.";

  const current = WIZARD_STEPS[step];
  const canNext = !errors[current.id];

  const finish = () =>
    completeWizard({
      voiceId: d.voiceId,
      enabledServiceIds: d.serviceIds,
      afterHours: d.afterHours,
      persona: { ...DEFAULT_CONFIG.persona, agentName: d.agentName, businessName: d.businessName, greeting: d.greeting, warmth: d.warmth, verbosity: d.verbosity, recordingDisclosure: d.recordingDisclosure },
    });

  return { step, setStep, steps: WIZARD_STEPS, current, d, set, errors, canNext, next: () => canNext && setStep((s) => Math.min(s + 1, WIZARD_STEPS.length - 1)), back: () => setStep((s) => Math.max(0, s - 1)), finish };
}
