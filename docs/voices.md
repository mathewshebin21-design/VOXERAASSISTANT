# Voices: free, downloadable and custom

## What's in the app now
In the Voice lab, turn on **Speak replies aloud** and choose a voice:

| Voice | Cost | Where it runs | Notes |
|---|---|---|---|
| Browser voice | free | your device | The operating system's built-in voice. Quality depends on the device. |
| **Kokoro · on device** | **free** | your device, in a background worker | Open-weight [Kokoro-82M](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX) (Apache-2.0). 8 British and 2 American voices, each with **Preview**. First use downloads the model once (about 92 MB, q8) from the official Hugging Face repository, then it is cached. No text or audio leaves the device. |
| ElevenLabs · live | paid, capped | ElevenLabs servers via the VOXERA API | Only when keys and caps are configured (see `phase-3-live-providers.md`). |

Kokoro voice grades are the model card's own ratings. The best British voice is **Emma (B-)**; the others are C or D. The two American voices are rated A and A-.

### How it is built
- `public/vendor/kokoro-js-1.2.1/` holds the unmodified browser build of `kokoro-js@1.2.1` (Apache-2.0), with its npm integrity hash and sha256 recorded in its README. It is served from our own origin, so no third-party script CDN is involved.
- `public/voice/kokoro-worker.js` loads the model in a Web Worker, so speech generation never freezes the page or the voice-activity timers.
- `src/lib/voice/kokoro.ts` contains `KokoroTts`, the same `TtsAdapter` interface as the other voices. It synthesises each sentence **as soon as it is queued** (the engine's new `prepare` hook), so the next sentence is usually ready when the current one finishes. The usual latency metrics (synthesis start, end-to-end) are measured per turn.
- The ONNX runtime's WebAssembly file is fetched by the library from jsDelivr, at the exact Transformers.js version the bundle pins.

### Verification (2026-10-26)
- A browser E2E test swaps the bundle for a tiny stand-in (`scripts/fixtures/fake-kokoro.js`) and checks the worker, picker, preview, download-progress UI and a full call spoken through it. 123/123 browser checks pass.
- The real vendored bundle loads in Chromium and exposes `KokoroTTS`.
- **Not verified here:** the real model download and speech quality or speed. This environment cannot reach Hugging Face or jsDelivr. A copy of the weights republished by a third party on npm (same size as the official file) was deliberately **not** run. The first real test is opening the Voice lab in Chrome on your computer.
- Expect a few seconds per sentence on slower phones, since Kokoro runs on the device's CPU through WebAssembly. Measure it in the lab.

## Making your own voice (next, needs your consent material)
- **Chatterbox** (Resemble AI) can create a voice from one short reference recording. Its model card says MIT; one revision says Apache-2.0, so confirm the official licence first. It is larger than Kokoro, and we expect it to need a GPU server for real-time calls; that has not been checked.
- Only clone a voice with the speaker's **written permission**: yours, or a voice actor you've paid. The agent must still say it is an AI.
- **Avoid for a commercial product:** XTTS-v2 (Coqui Public Model License, non-commercial) and F5-TTS (CC-BY-NC weights). Piper voices are licensed one by one.

## For phone calls (Phase 4)
Calls are processed on a server, so Kokoro (or Chatterbox) will run as a small TTS service next to the API, behind the same adapter. That needs an always-on server, which is a fixed monthly cost rather than per-character billing, and requires your approval.
