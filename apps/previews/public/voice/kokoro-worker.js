// Runs the Kokoro-82M text-to-speech model off the main thread, entirely on the device.
// The model (~92 MB, q8) and voice files are fetched once from the official Hugging Face
// repository and cached by the browser. No audio or text leaves the device.
import { KokoroTTS } from "/vendor/kokoro-js-1.2.1/kokoro.web.js";

const MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
let loading = null;

function load() {
  loading ??= KokoroTTS.from_pretrained(MODEL, {
    dtype: "q8",
    device: "wasm",
    progress_callback: (p) => postMessage({ type: "progress", status: p.status, file: p.file, loaded: p.loaded, total: p.total }),
  }).catch((e) => {
    loading = null; // allow a retry
    throw e;
  });
  return loading;
}

onmessage = async ({ data }) => {
  try {
    if (data.type === "load") {
      await load();
      postMessage({ type: "ready" });
    } else if (data.type === "speak") {
      const tts = await load();
      const t0 = performance.now();
      const audio = await tts.generate(data.text, { voice: data.voice, speed: data.speed });
      const wav = audio.toWav();
      postMessage({ type: "audio", id: data.id, wav, genMs: performance.now() - t0, seconds: audio.audio.length / audio.sampling_rate }, [wav]);
    }
  } catch (e) {
    postMessage({ type: "error", id: data.id, message: String((e && e.message) || e) });
  }
};
