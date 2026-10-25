"use client";

import { useEffect, useRef } from "react";

/**
 * Canvas waveform. Driven by a 0–1 `level` (from the simulator) — it visualises
 * simulated speech activity, not real audio.
 */
export function Waveform({ level, color = "139 92 246", accent = "34 211 238", height = 64, bars = 72, active = true }: { level: number; color?: string; accent?: string; height?: number; bars?: number; active?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const levelRef = useRef(level);
  levelRef.current = level;
  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext("2d")!;
    let raf = 0;
    const hist: number[] = Array(bars).fill(0.04);
    let t = 0;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth, h = c.clientHeight;
      if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      t += 1;
      const target = active ? levelRef.current : 0;
      if (t % 2 === 0) {
        hist.shift();
        hist.push(Math.max(0.04, target * (0.55 + 0.45 * Math.abs(Math.sin(t * 0.37))) + (active ? 0.03 * Math.random() : 0)));
      }
      const bw = w / bars;
      hist.forEach((v, i) => {
        const bh = Math.max(2, v * (h - 6));
        const x = i * bw;
        const g = ctx.createLinearGradient(0, h / 2 - bh / 2, 0, h / 2 + bh / 2);
        g.addColorStop(0, `rgb(${accent} / ${0.35 + v * 0.6})`);
        g.addColorStop(1, `rgb(${color} / ${0.35 + v * 0.6})`);
        ctx.fillStyle = g;
        ctx.fillRect(x + bw * 0.2, h / 2 - bh / 2, bw * 0.6, bh);
      });
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [bars, color, accent, active]);
  return <canvas ref={ref} style={{ height }} className="block w-full" aria-hidden />;
}
