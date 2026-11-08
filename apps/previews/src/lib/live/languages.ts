// Language registry and route preview (ADR-0006), as returned by the VOXERA API.

export type Evidence = "tested" | "advertised" | "unverified" | "unsupported";
export type Region = "device" | "uk" | "eu" | "us" | "global";

export interface LanguageRow {
  code: string;
  name: string;
  native_name: string;
  rtl: boolean;
  stt: Evidence;
  llm: Evidence;
  tts: Evidence;
  development_target: boolean;
}

export interface ProviderRow {
  id: string;
  kind: "stt" | "llm" | "tts";
  name: string;
  regions: Region[];
  streaming: boolean;
  paid: boolean;
  integrated: boolean;
  configured: boolean;
  languages: Record<string, Evidence>;
  note: string;
}

export interface LaunchRow {
  country: string;
  name: string;
  ready: boolean;
  blockers: string[];
}

export interface LanguagesResponse {
  languages: LanguageRow[];
  providers: ProviderRow[];
  launch: LaunchRow[];
  evidence_levels: Record<Evidence, string>;
}

export interface RoutePolicy {
  language: string;
  languages: string[];
  default_language: string;
  fallback_language: string | null;
  allowed_regions: Region[];
  allow_paid: boolean;
  allow_unverified: boolean;
}

export type RouteResult =
  | {
      routable: true;
      language: string;
      requested: string;
      language_fallback: boolean;
      stt: string;
      llm: string;
      tts: string;
      evidence: Record<string, Evidence>;
      reasons: string[];
    }
  | { routable: false; language: string; gaps: Record<string, string> };

export const ALL_REGIONS: Region[] = ["device", "uk", "eu", "us", "global"];

export const EVIDENCE_LABEL: Record<Evidence, string> = {
  tested: "Tested by VOXERA",
  advertised: "Vendor says so",
  unverified: "Unverified",
  unsupported: "Not supported",
};

export const EVIDENCE_TONE: Record<Evidence, "lime" | "cyan" | "amber" | "pink"> = {
  tested: "lime",
  advertised: "cyan",
  unverified: "amber",
  unsupported: "pink",
};

export const REGION_LABEL: Record<Region, string> = {
  device: "On the device",
  uk: "United Kingdom",
  eu: "European Union",
  us: "United States",
  global: "Global (provider's choice)",
};

/** A valid policy for the API: the call's language and the default are always among the workspace's
 * languages, and the fallback is one of them too (or none). The API applies the same rules. */
export function buildPolicy(p: RoutePolicy): RoutePolicy {
  const languages = Array.from(new Set([p.default_language, ...p.languages, p.language]));
  const fallback = p.fallback_language && languages.includes(p.fallback_language) ? p.fallback_language : null;
  const regions = p.allowed_regions.length ? p.allowed_regions : (["device"] as Region[]);
  return { ...p, languages, fallback_language: fallback, allowed_regions: regions };
}

/** One sentence a business owner can read about a route decision. */
export function describeRoute(r: RouteResult, names: Record<string, string>): string {
  const name = (code: string) => names[code] ?? code;
  if (!r.routable) {
    const kinds = Object.keys(r.gaps).map((k) => ({ stt: "speech recognition", llm: "the language model", tts: "speech output", language: "language" })[k] ?? k);
    return `A call in ${name(r.language)} can't be routed under these settings: no allowed provider for ${kinds.join(", ")}.`;
  }
  if (r.language_fallback) {
    return `${name(r.requested)} isn't available under these settings, so the call would continue in ${name(r.language)}.`;
  }
  return `A call in ${name(r.language)} would use these providers.`;
}
