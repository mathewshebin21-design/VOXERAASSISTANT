"use client";

import { useEffect, useState } from "react";
import { PageHead, Panel, Stat, Tag } from "@/components/command/ui";
import { api, ApiError } from "@/lib/live/api";

interface BillingOverview {
  organization_id: string;
  state: string | null;
  price_code: string | null;
  currency: string | null;
  price_minor_units: number | null;
  quota_limit: number | null;
  quota_consumed: number | null;
  quota_reserved: number | null;
  quota_available: number | null;
  synthetic_usage_events: number;
}

export function LiveBillingOverview({ organizationId }: { organizationId: string }) {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [overview, setOverview] = useState<BillingOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setOverview(null);
    setError(null);
    setLoading(true);
    if (!/^(?!0000|9999-12)[0-9]{4}-(0[1-9]|1[0-2])$/.test(month)) {
      setError("Select a valid billing month.");
      setLoading(false);
      return () => { active = false; };
    }
    void api<BillingOverview>(`/orgs/${encodeURIComponent(organizationId)}/billing/overview?month=${encodeURIComponent(month)}`)
      .then((result) => {
        if (!active) return;
        if (result.organization_id !== organizationId) {
          setError("Billing response did not match the selected workspace.");
          return;
        }
        setOverview(result);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof ApiError ? reason.detail : "Billing data could not be loaded.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [organizationId, month, attempt]);

  return (
    <>
      <PageHead kicker="Admin · billing" title="Billing overview"><Tag tone="warn">Preview · payments disabled</Tag></PageHead>
      <p className="mb-4 text-sm text-cmd-mute">Read-only workspace data. Synthetic usage is not billable. No invoices or payment collection are enabled.</p>
      <label className="mb-4 flex items-center gap-3 text-sm">
        Billing month (UTC)
        <input aria-label="Billing month" type="month" min="0001-01" max="9999-11" value={month}
          onChange={(event) => setMonth(event.target.value)}
          className="rounded border border-cmd-line bg-cmd-panel px-3 py-2" />
      </label>
      {loading && <p role="status">Loading billing overview…</p>}
      {error && <Panel title="Billing data unavailable"><p role="alert">{error}</p>
        <button type="button" onClick={() => setAttempt((n) => n + 1)} className="mt-3 underline">Try again</button>
      </Panel>}
      {!loading && !error && overview && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Stat label="Subscription" value={overview.state ?? "Not configured"} sub={overview.price_code ?? "No price version"} />
          <Stat label="Quota available" value={overview.quota_available?.toLocaleString() ?? "Not configured"}
            sub={overview.quota_limit === null ? "No quota period" : `Limit ${overview.quota_limit} · used ${overview.quota_consumed} · reserved ${overview.quota_reserved}`} />
          <Stat label="Synthetic usage events" value={overview.synthetic_usage_events.toLocaleString()} sub={`Non-billable · ${month} UTC`} />
        </div>
      )}
    </>
  );
}
