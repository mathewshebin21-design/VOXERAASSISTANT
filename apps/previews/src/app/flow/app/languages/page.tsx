"use client";

import { useMemo, useState } from "react";
import { Notice } from "@/components/flow/live-ui";
import { Chip, FBtn, Glass, GHead, Heading } from "@/components/flow/ui";
import { api, ApiError } from "@/lib/live/api";
import {
  ALL_REGIONS,
  buildPolicy,
  describeRoute,
  EVIDENCE_LABEL,
  EVIDENCE_TONE,
  REGION_LABEL,
  type LanguagesResponse,
  type Region,
  type RouteResult,
} from "@/lib/live/languages";
import { useActiveOrg, useApi } from "@/lib/live/session";

const KINDS = [
  ["stt", "Speech recognition"],
  ["llm", "Language model"],
  ["tts", "Speech output"],
] as const;

/** Which languages VOXERA can handle, on what evidence, and which providers a call would use. Read-only. */
export default function Languages() {
  const active = useActiveOrg();
  const reg = useApi<LanguagesResponse>(active ? `/orgs/${active.organization.id}/voice/languages` : null);
  const names = useMemo(() => Object.fromEntries((reg.data?.languages ?? []).map((l) => [l.code, l.name])), [reg.data]);
  const providerName = useMemo(() => Object.fromEntries((reg.data?.providers ?? []).map((p) => [p.id, p.name])), [reg.data]);

  const [language, setLanguage] = useState("hi-IN");
  const [spoken, setSpoken] = useState<string[]>(["en-GB"]);
  const [regions, setRegions] = useState<Region[]>(["device", "uk", "eu"]);
  const [allowPaid, setAllowPaid] = useState(false);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!active) return <Notice>Sign in to a workspace to see languages.</Notice>;

  const preview = async () => {
    setError(null);
    const body = buildPolicy({
      language,
      languages: spoken,
      default_language: "en-GB",
      fallback_language: "en-GB",
      allowed_regions: regions,
      allow_paid: allowPaid,
      allow_unverified: false,
    });
    try {
      setRoute(await api<RouteResult>(`/orgs/${active.organization.id}/voice/route`, { method: "POST", body }));
    } catch (e) {
      setRoute(null);
      setError(e instanceof ApiError ? e.detail : "Route preview failed");
    }
  };
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <>
      <Heading kicker="Voice" title="Languages and providers">
        <Chip tone="amber">nothing tested on real calls yet</Chip>
      </Heading>
      {reg.error && <Notice kind="error">{reg.error.detail}</Notice>}

      <Glass className="mb-4">
        <GHead title="Language coverage" right={<span className="text-xs text-flw-mute">best evidence across integrated providers</span>} />
        <div className="overflow-x-auto p-4">
          <table className="w-full text-sm" data-testid="language-table">
            <thead className="text-xs text-flw-mute">
              <tr>
                <th className="py-1 text-left font-normal">Language</th>
                {KINDS.map(([, label]) => <th key={label} className="text-left font-normal">{label}</th>)}
              </tr>
            </thead>
            <tbody>
              {(reg.data?.languages ?? []).map((l) => (
                <tr key={l.code} className="border-t border-flw-line/60">
                  <td className="py-2">
                    <div>{l.name} {l.development_target && <Chip tone="violet">target</Chip>}</div>
                    <div className="text-xs text-flw-mute"><span dir={l.rtl ? "rtl" : "ltr"} lang={l.code}>{l.native_name}</span> · {l.code}</div>
                  </td>
                  {KINDS.map(([k]) => <td key={k}><Chip tone={EVIDENCE_TONE[l[k]]}>{EVIDENCE_LABEL[l[k]]}</Chip></td>)}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-flw-mute">
            &ldquo;Vendor says so&rdquo; means the provider lists the language; VOXERA has not yet verified it on calls. A language becomes
            &ldquo;Tested by VOXERA&rdquo; only after recorded test calls.
          </p>
        </div>
      </Glass>

      <Glass glow="cyan" className="mb-4">
        <GHead title="Route preview" right={<Chip tone="lime">calls nothing</Chip>} />
        <div className="grid gap-4 p-4 md:grid-cols-2">
          <label className="text-sm">
            <span className="text-xs text-flw-mute">Caller speaks</span>
            <select className="mt-1 w-full rounded-lg border border-flw-line bg-transparent p-2" value={language} onChange={(e) => setLanguage(e.target.value)} data-testid="route-language">
              {(reg.data?.languages ?? []).map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
            </select>
          </label>
          <fieldset className="text-sm">
            <legend className="text-xs text-flw-mute">Languages your receptionist may speak</legend>
            <div className="mt-1 flex flex-wrap gap-2">
              {(reg.data?.languages ?? []).map((l) => (
                <label key={l.code} className="flex items-center gap-1">
                  <input type="checkbox" checked={l.code === "en-GB" || spoken.includes(l.code)} disabled={l.code === "en-GB"} onChange={() => setSpoken(toggle(spoken, l.code))} />
                  {l.name}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="text-sm">
            <legend className="text-xs text-flw-mute">Where call data may be processed</legend>
            <div className="mt-1 flex flex-wrap gap-2">
              {ALL_REGIONS.map((r) => (
                <label key={r} className="flex items-center gap-1">
                  <input type="checkbox" checked={regions.includes(r)} onChange={() => setRegions(toggle(regions, r))} data-testid={`region-${r}`} />
                  {REGION_LABEL[r]}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={allowPaid} onChange={(e) => setAllowPaid(e.target.checked)} />
            Allow paid providers (only those configured with a key and a monthly cap)
          </label>
        </div>
        <div className="flex items-center gap-3 px-4 pb-4">
          <FBtn onClick={preview} data-testid="route-preview">Preview route</FBtn>
          <span className="text-xs text-flw-mute">Settings here are not saved.</span>
        </div>
        {error && <div className="px-4 pb-4"><Notice kind="error">{error}</Notice></div>}
        {route && (
          <div className="border-t border-flw-line/60 p-4 text-sm" data-testid="route-result">
            <p>{describeRoute(route, names)}</p>
            {route.routable ? (
              <ul className="mt-2 space-y-1">
                {KINDS.map(([k, label]) => (
                  <li key={k} className="flex items-center gap-2">
                    <span className="w-40 text-flw-mute">{label}</span>
                    <span>{providerName[route[k]] ?? route[k]}</span>
                    {route.evidence[k] && <Chip tone={EVIDENCE_TONE[route.evidence[k]]}>{EVIDENCE_LABEL[route.evidence[k]]}</Chip>}
                  </li>
                ))}
              </ul>
            ) : (
              <ul className="mt-2 space-y-1 text-xs text-flw-mute">
                {Object.entries(route.gaps).map(([k, why]) => <li key={k}>{k}: {why}</li>)}
              </ul>
            )}
          </div>
        )}
      </Glass>

      <Glass>
        <GHead title="Providers" />
        <div className="overflow-x-auto p-4">
          <table className="w-full text-sm">
            <thead className="text-xs text-flw-mute">
              <tr><th className="py-1 text-left font-normal">Provider</th><th className="text-left font-normal">Data processed in</th><th className="text-left font-normal">Status</th></tr>
            </thead>
            <tbody>
              {(reg.data?.providers ?? []).map((p) => (
                <tr key={p.id} className="border-t border-flw-line/60 align-top">
                  <td className="py-2"><div>{p.name}</div><div className="text-xs text-flw-mute">{p.note}</div></td>
                  <td className="text-xs">{p.regions.map((r) => REGION_LABEL[r]).join(", ")}</td>
                  <td>
                    {!p.integrated ? <Chip tone="amber">candidate</Chip> : p.configured ? <Chip tone="lime">configured</Chip> : <Chip tone="pink">not configured</Chip>}
                    {p.paid && <span className="ml-1 text-xs text-flw-mute">paid</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Glass>
    </>
  );
}
