// Energy-based voice activity detection with an adaptive noise floor.
//
// Deliberately simple and dependency-free so it runs on every browser and in
// unit tests. It is the turn-taking signal for barge-in and silence detection;
// end-of-utterance still comes from the speech recogniser's final result.
// A neural VAD (e.g. Silero) can replace it behind the same interface.

export interface VadConfig {
  /** dB above the noise floor needed to count a frame as speech. */
  thresholdDb: number;
  /** Speech must last this long before speech_start fires (rejects clicks). */
  minSpeechMs: number;
  /** Silence must last this long before speech_end fires. */
  hangoverMs: number;
  /** How fast the floor follows quieter input (0–1 per frame). */
  floorFall: number;
  /** How fast the floor follows louder, non-speech input (0–1 per frame). */
  floorRise: number;
  /** The floor never drops below this (digital silence would make every hiss "speech"). */
  minFloorDb: number;
  /** The first frames only measure the room's noise floor. */
  calibrateMs: number;
}

export const DEFAULT_VAD: VadConfig = { thresholdDb: 12, minSpeechMs: 120, hangoverMs: 650, floorFall: 0.2, floorRise: 0.02, minFloorDb: -65, calibrateMs: 300 };

export type VadEvent = { type: "speech_start"; atMs: number } | { type: "speech_end"; atMs: number; durationMs: number };

export const toDb = (rms: number) => 20 * Math.log10(Math.max(rms, 1e-6));

export class Vad {
  floorDb: number;
  levelDb = -100;
  speaking = false;
  private aboveSince: number | null = null;
  private belowSince: number | null = null;
  private startedAt = 0;
  private calib: { since: number; sum: number; n: number } | null = null;

  constructor(public cfg: VadConfig = DEFAULT_VAD) {
    this.floorDb = cfg.minFloorDb;
  }

  /** Feed one frame's RMS amplitude (0–1) at time `t` (ms). Returns an event on a state change. */
  push(rms: number, t: number): VadEvent | null {
    const db = toDb(rms);
    this.levelDb = db;
    this.calib ??= { since: t, sum: 0, n: 0 };
    if (t - this.calib.since < this.cfg.calibrateMs) {
      this.calib.sum += db; this.calib.n++;
      this.floorDb = Math.max(this.cfg.minFloorDb, this.calib.sum / this.calib.n);
      return null;
    }
    const above = db > this.floorDb + this.cfg.thresholdDb;
    // Track the floor only while nobody is talking, so speech doesn't raise it.
    if (!this.speaking && !above) {
      const k = db < this.floorDb ? this.cfg.floorFall : this.cfg.floorRise;
      this.floorDb = Math.max(this.cfg.minFloorDb, this.floorDb + (db - this.floorDb) * k);
    } else if (!this.speaking && above && this.aboveSince === null) {
      // Steady loud noise (a fan, traffic) eventually becomes the new floor.
      this.floorDb = Math.max(this.cfg.minFloorDb, this.floorDb + (db - this.floorDb) * this.cfg.floorRise * 0.25);
    }

    if (!this.speaking) {
      if (above) {
        this.aboveSince ??= t;
        if (t - this.aboveSince >= this.cfg.minSpeechMs) {
          this.speaking = true;
          this.startedAt = this.aboveSince;
          this.belowSince = null;
          return { type: "speech_start", atMs: this.aboveSince };
        }
      } else this.aboveSince = null;
      return null;
    }
    // Hysteresis: a little quieter than the start threshold still counts as speech.
    const stillSpeech = db > this.floorDb + this.cfg.thresholdDb - 3;
    if (stillSpeech) { this.belowSince = null; return null; }
    this.belowSince ??= t;
    if (t - this.belowSince >= this.cfg.hangoverMs) {
      this.speaking = false;
      this.aboveSince = null;
      const end = this.belowSince;
      this.belowSince = null;
      return { type: "speech_end", atMs: end, durationMs: end - this.startedAt };
    }
    return null;
  }

  reset() {
    this.speaking = false;
    this.aboveSince = this.belowSince = null;
    this.calib = null;
  }
}
