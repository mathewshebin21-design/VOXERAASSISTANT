// Test stand-in for the vendored kokoro-js bundle: same exports and call shapes,
// but it synthesises a short tone instead of loading the 92 MB model.
export class KokoroTTS {
  static async from_pretrained(_id, { progress_callback } = {}) {
    progress_callback?.({ status: "progress", file: "onnx/model_quantized.onnx", loaded: 46_000_000, total: 92_361_116 });
    await new Promise((r) => setTimeout(r, 300));
    progress_callback?.({ status: "progress", file: "onnx/model_quantized.onnx", loaded: 92_361_116, total: 92_361_116 });
    return new KokoroTTS();
  }
  async generate(text, { voice }) {
    if (!/^[ab][fm]_[a-z]+$/.test(voice)) throw new Error(`unknown voice ${voice}`);
    const sr = 24000;
    const audio = new Float32Array(Math.round(sr * Math.min(1.5, 0.03 * text.length)));
    for (let i = 0; i < audio.length; i++) audio[i] = 0.1 * Math.sin((2 * Math.PI * 330 * i) / sr);
    return {
      audio, sampling_rate: sr,
      toWav() {
        const buf = new ArrayBuffer(44 + audio.length * 2), v = new DataView(buf);
        const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
        str(0, "RIFF"); v.setUint32(4, 36 + audio.length * 2, true); str(8, "WAVEfmt ");
        v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true);
        v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, "data"); v.setUint32(40, audio.length * 2, true);
        audio.forEach((s, i) => v.setInt16(44 + i * 2, s * 32767, true));
        return buf;
      },
    };
  }
}
export class TextSplitterStream {}
export const env = {};
