import { clsx } from "clsx";

/** Persistent label so no screen can be mistaken for live production data. */
export function DemoBadge({ className, children = "Demo data" }: { className?: string; children?: React.ReactNode }) {
  return (
    <span
      className={clsx("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider", className)}
      title="Synthetic data generated for this preview. No real calls, customers or integrations."
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {children}
    </span>
  );
}
