import Link from "next/link";

const designs = [
  { href: "/command", code: "A", name: "VOXERA Command", line: "Enterprise voice operations terminal", swatch: "from-[#09090c] via-[#1a1a21] to-[#8b5cf6]", tone: "Dense · data-first · sidebar console" },
  { href: "/atelier", code: "B", name: "VOXERA Atelier", line: "Luxury AI receptionist studio", swatch: "from-[#faf7f1] via-[#e4ddd0] to-[#c9aa78]", tone: "Editorial · guided · owner-friendly" },
  { href: "/flow", code: "C", name: "VOXERA Flow", line: "AI-native conversation studio", swatch: "from-[#05050a] via-[#a78bfa] to-[#67e8f9]", tone: "Canvas · node-based · immersive" },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-[#0b0b0f] px-6 py-16 text-[#e8e8f0]">
      <div className="mx-auto max-w-5xl">
        <p className="text-xs uppercase tracking-[0.3em] text-[#8c8c9e]">VOXERA AI · Phase 1</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">Three design directions</h1>
        <p className="mt-4 max-w-2xl text-[#a8a8ba]">
          Each preview is a separate, runnable front end with its own design system, navigation model and information architecture.
          All three share the same synthetic dataset and the same rule-based conversation simulator so they can be compared fairly.
        </p>
        <div className="mt-4 inline-flex rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-200">
          Demo only — synthetic data, simulated calls, no live telephony, no real integrations, no authentication.
        </div>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {designs.map((d) => (
            <Link key={d.href} href={d.href} className="group overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] transition hover:border-white/30 hover:bg-white/[0.06]">
              <div className={`h-36 bg-gradient-to-br ${d.swatch}`} />
              <div className="p-5">
                <div className="text-xs font-mono text-[#8c8c9e]">Design {d.code}</div>
                <div className="mt-1 text-lg font-semibold">{d.name}</div>
                <div className="text-sm text-[#a8a8ba]">{d.line}</div>
                <div className="mt-3 text-xs text-[#8c8c9e]">{d.tone}</div>
                <div className="mt-4 text-sm font-medium text-white group-hover:underline">Open preview →</div>
              </div>
            </Link>
          ))}
        </div>
        <p className="mt-10 text-sm text-[#8c8c9e]">
          Research and rationale: <code className="text-[#c8c8d8]">docs/research/phase-0-competitive-research.md</code> and{" "}
          <code className="text-[#c8c8d8]">docs/design/phase-1-design-previews.md</code> in the repository.
        </p>
      </div>
    </main>
  );
}
