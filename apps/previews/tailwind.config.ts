import type { Config } from "tailwindcss";

// Each design keeps its own token set (CSS variables in src/styles/*.css).
// Tailwind colours below map onto those variables so utilities stay design-scoped.
const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // A — Command
        cmd: {
          bg: v("cmd-bg"), panel: v("cmd-panel"), raised: v("cmd-raised"), line: v("cmd-line"),
          text: v("cmd-text"), mute: v("cmd-mute"), violet: v("cmd-violet"), cyan: v("cmd-cyan"),
          ok: v("cmd-ok"), warn: v("cmd-warn"), bad: v("cmd-bad"),
        },
        // B — Atelier
        atl: {
          bg: v("atl-bg"), paper: v("atl-paper"), line: v("atl-line"), ink: v("atl-ink"),
          soft: v("atl-soft"), champ: v("atl-champ"), champdeep: v("atl-champdeep"), sage: v("atl-sage"), rose: v("atl-rose"),
        },
        // C — Flow
        flw: {
          bg: v("flw-bg"), surface: v("flw-surface"), glass: v("flw-glass"), line: v("flw-line"),
          text: v("flw-text"), mute: v("flw-mute"), violet: v("flw-violet"), cyan: v("flw-cyan"),
          pink: v("flw-pink"), lime: v("flw-lime"), amber: v("flw-amber"),
        },
      },
      fontFamily: {
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        serif: ["var(--font-serif)", "ui-serif", "Georgia", "serif"],
        display: ["var(--font-display)", "var(--font-sans)", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
