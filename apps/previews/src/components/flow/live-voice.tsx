"use client";

import { Save } from "lucide-react";
import { useEffect, useState } from "react";
import { fmtWhen } from "./live-ui";
import { Chip, FBtn, Glass, GHead } from "./ui";
import { api, ApiError, PERMS } from "@/lib/live/api";
import { useActiveOrg, useApi } from "@/lib/live/session";
import type { VoiceLab } from "@/lib/voice/use-voice-lab";

interface SavedSession {
  id: string; started_at: string; duration_ms: number; brain_provider: string; tts_provider: string;
  summary: { turns: number; time_to_first_audio_ms: number | null; e2e_ms: { p50: number | null; p95: number | null }; barge_ins: number };
}

/** Saves the finished test call's measured metrics (no audio, no transcript text) to the workspace. */
export function SaveVoiceSession({ lab }: { lab: VoiceLab }) {
  const active = useActiveOrg();
  const [state, setState] = useState<{ key: string; msg: string; ok: boolean } | null>(null);
  if (!active || !PERMS[active.role].write) return null;
  const ready = !!lab.ended && lab.turns.length > 0 && !!lab.startedAt;
  const saved = state?.key === lab.sessionKey && state.ok;
  const save = async () => {
    try {
      await api(`/orgs/${active.organization.id}/voice-sessions`, {
        method: "POST",
        body: {
          client_session_id: lab.sessionKey, started_at: new Date(lab.startedAt!).toISOString(),
          duration_ms: Math.max(0, (lab.endedAt ?? Date.now()) - lab.startedAt!),
          stt_provider: lab.providers.stt, brain_provider: lab.providers.brain, tts_provider: lab.providers.tts,
          turns: lab.turns.slice(0, 300),
        },
      });
      setState({ key: lab.sessionKey, msg: "Saved to workspace", ok: true });
      window.dispatchEvent(new Event("voxera:voice-saved"));
    } catch (e) { setState({ key: lab.sessionKey, msg: e instanceof ApiError ? e.detail : "Save failed", ok: false }); }
  };
  return (
    <span className="flex items-center gap-2">
      {state?.key === lab.sessionKey && <span role={state.ok ? "status" : "alert"} className={state.ok ? "text-xs text-flw-lime" : "text-xs text-flw-pink"}>{state.msg}</span>}
      <FBtn onClick={save} disabled={!ready || saved} title={ready ? "Save measured metrics" : "End the call to save it"}><Save size={13} /> Save</FBtn>
    </span>
  );
}

/** Previously saved test calls for the active workspace. */
export function VoiceHistory() {
  const active = useActiveOrg();
  const list = useApi<SavedSession[]>(active ? `/orgs/${active.organization.id}/voice-sessions?limit=10` : null);
  const { reload } = list;
  useEffect(() => {
    const on = () => void reload();
    window.addEventListener("voxera:voice-saved", on);
    return () => window.removeEventListener("voxera:voice-saved", on);
  }, [reload]);
  if (!active) return null;
  return (
    <Glass>
      <GHead title={`Saved test calls · ${active.organization.name}`} right={<Chip tone="lime">live data</Chip>} />
      {!list.data?.length ? <p className="p-4 text-sm text-flw-mute">No saved test calls yet. End a call and press Save.</p> : (
        <div className="overflow-x-auto p-4">
          <table className="w-full text-xs" data-testid="voice-history">
            <thead className="text-flw-mute"><tr><th className="py-1 text-left font-normal">When</th><th className="text-right font-normal">Turns</th><th className="text-right font-normal">First audio</th><th className="text-right font-normal">E2E p50 / p95</th><th className="text-right font-normal">Barge-ins</th></tr></thead>
            <tbody>{list.data.map((s) => (
              <tr key={s.id} className="border-t border-flw-line/60">
                <td className="py-1.5">{fmtWhen(s.started_at)} <span className="text-flw-mute">· {Math.round(s.duration_ms / 1000)} s</span></td>
                <td className="text-right font-mono">{s.summary.turns}</td>
                <td className="text-right font-mono">{s.summary.time_to_first_audio_ms ?? "—"} ms</td>
                <td className="text-right font-mono">{s.summary.e2e_ms.p50 ?? "—"} / {s.summary.e2e_ms.p95 ?? "—"} ms</td>
                <td className="text-right font-mono">{s.summary.barge_ins}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </Glass>
  );
}
