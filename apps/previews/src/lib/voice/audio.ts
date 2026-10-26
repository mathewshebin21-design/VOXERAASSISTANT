// Plays one audio clip with abort support; shared by the server and on-device voices.
import { ProviderError } from "./types";

export interface Player { stop: (() => void) | null; audio: HTMLAudioElement | null }

export function playBlob(blob: Blob, signal: AbortSignal, onStart: () => void, player: Player, stage: "tts" = "tts"): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  player.audio = audio;
  return new Promise<void>((resolve, reject) => {
    const finish = (err?: ProviderError) => {
      URL.revokeObjectURL(url);
      player.stop = null;
      signal.removeEventListener("abort", onAbort);
      if (err) reject(err); else resolve();
    };
    const onAbort = () => { audio.pause(); finish(); };
    player.stop = onAbort;
    signal.addEventListener("abort", onAbort, { once: true });
    audio.onplaying = () => onStart();
    audio.onended = () => finish();
    audio.onerror = () => finish(new ProviderError(stage, "audio could not be played"));
    audio.play().catch((e) => finish(new ProviderError(stage, e instanceof Error ? e.message : "playback blocked")));
  });
}
