// Adapters for the live (paid, metered) providers. They call VOXERA's own API
// through the same-origin proxy; provider keys never reach the browser, and the
// API enforces per-workspace and global monthly caps before every call.

import { playBlob, type Player } from "./audio";
import { ProviderError, type BrainAdapter, type BrainChunk, type TtsAdapter } from "./types";

const headers = { "content-type": "application/json", "x-voxera-csrf": "1" };

async function failure(stage: "brain" | "tts", r: Response): Promise<ProviderError> {
  let detail = `HTTP ${r.status}`;
  try { detail = (await r.json()).detail ?? detail; } catch { /* not JSON */ }
  // Cap reached / provider switched off won't fix itself by retrying.
  return new ProviderError(stage, detail, !(r.status === 429 || r.status === 503 || r.status === 403));
}

/** Streams replies from the server-side receptionist (Claude, with tools over the workspace's data). */
export class ApiBrain implements BrainAdapter {
  readonly costPerMinGbp = null; // per-token prices are not configured in VOXERA
  private history: { role: "user" | "assistant"; text: string }[] = [];
  constructor(private orgId: string, readonly name: string) {}

  reset() { this.history = []; }

  async *greet(signal: AbortSignal): AsyncIterable<BrainChunk> {
    const r = await fetch(`/api/v1/orgs/${this.orgId}/live/greeting`, { signal });
    if (!r.ok) throw await failure("brain", r);
    const { text } = (await r.json()) as { text: string };
    this.history.push({ role: "assistant", text });
    yield { type: "text", text };
  }

  async *respond(text: string, signal: AbortSignal): AsyncIterable<BrainChunk> {
    this.history.push({ role: "user", text });
    const r = await fetch(`/api/v1/orgs/${this.orgId}/live/brain`, {
      method: "POST", headers, signal,
      body: JSON.stringify({ request_id: `turn-${crypto.randomUUID()}`, messages: this.history.slice(-40) }),
    });
    if (!r.ok || !r.body) throw await failure("brain", r);
    const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "";
    let said = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        let i: number;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const line = buf.slice(0, i).split("\n").find((l) => l.startsWith("data: "));
          buf = buf.slice(i + 2);
          if (!line) continue;
          const e = JSON.parse(line.slice(6)) as { type: string; text?: string; name?: string; ok?: boolean; result?: string; message?: string };
          if (e.type === "text" && e.text) { said += e.text; yield { type: "text", text: e.text }; }
          else if (e.type === "tool") yield { type: "tool", name: e.name ?? "tool", args: {}, ok: !!e.ok, result: e.result ?? "" };
          else if (e.type === "error") throw new ProviderError("brain", e.message ?? "provider error");
        }
      }
    } finally {
      // Keep what the caller actually heard (or was about to) in the history, even after a barge-in.
      if (said) this.history.push({ role: "assistant", text: said });
      reader.cancel().catch(() => undefined);
    }
  }
}

/** One MP3 per sentence from the server-side TTS provider, played with an <audio> element. */
export class ServerTts implements TtsAdapter {
  readonly costPerMinGbp = null;
  private player: Player = { stop: null, audio: null };
  constructor(private orgId: string, readonly name: string) {}

  async speak(text: string, signal: AbortSignal, onStart: () => void): Promise<void> {
    const r = await fetch(`/api/v1/orgs/${this.orgId}/live/tts`, {
      method: "POST", headers, signal, body: JSON.stringify({ request_id: `tts-${crypto.randomUUID()}`, text: text.slice(0, 600) }),
    }).catch((e) => { if (signal.aborted) return null; throw new ProviderError("tts", e instanceof Error ? e.message : "network error"); });
    if (!r) return;
    if (!r.ok) throw await failure("tts", r);
    await playBlob(await r.blob(), signal, onStart, this.player);
  }

  cancel() { this.player.stop?.(); this.player.audio?.pause(); }
}
