"use client";

// Browser → Next.js proxy (/api/v1/*) → VOXERA API. Tokens never reach this code.

export class ApiError extends Error {
  constructor(public status: number, public detail: string, public data?: unknown) {
    super(detail);
  }
}

function detailOf(body: unknown): string {
  if (!body || typeof body !== "object") return "Something went wrong";
  const d = (body as { detail?: unknown }).detail;
  if (typeof d === "string") return d;
  if (d && typeof d === "object" && typeof (d as { message?: unknown }).message === "string") return (d as { message: string }).message;
  // FastAPI validation errors: [{loc, msg}, …]
  if (Array.isArray(d) && d.length) return d.map((e: { loc?: unknown[]; msg?: string }) => `${(e.loc ?? []).slice(-1)[0] ?? "field"}: ${e.msg}`).join("; ");
  return "Something went wrong";
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = init.method ?? "GET";
  const r = await fetch(`/api/v1${path}`, {
    method,
    headers: { ...(init.body !== undefined ? { "content-type": "application/json" } : {}), "x-voxera-csrf": "1" },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  if (r.status === 204) return undefined as T;
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new ApiError(r.status, detailOf(data), (data as { detail?: unknown } | null)?.detail);
  return data as T;
}

export async function session(action: "login" | "signup" | "logout", body?: unknown): Promise<void> {
  const r = await fetch(`/api/session/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-voxera-csrf": "1" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok && r.status !== 204) throw new ApiError(r.status, detailOf(await r.json().catch(() => null)));
}

// ---- API types (mirrors services/api/app/schemas.py) ----
export type Role = "owner" | "admin" | "manager" | "staff" | "viewer";
export interface User { id: string; email: string; full_name: string; created_at: string }
export interface Org { id: string; name: string; created_at: string }
export interface MyOrg { organization: Org; role: Role }
export interface Member { user_id: string; email: string; full_name: string; role: Role; joined_at: string }
export interface Invitation { id: string; email: string; role: Role; created_at: string; expires_at: string; accepted_at: string | null; revoked_at: string | null; token: string | null }
export interface BusinessProfile { display_name: string; sector: string; phone: string | null; email: string | null; website: string | null; address_line1: string | null; address_line2: string | null; city: string | null; postcode: string | null; country: string; description: string | null }
export interface HoursInterval { weekday: number; opens_at: string; closes_at: string }
export interface Service { id: string; name: string; category: string | null; duration_min: number; buffer_min: number; price_from_pence: number | null; bookable_by_agent: boolean; requires_patch_test: boolean; active: boolean }
export interface WorkspaceSettings { timezone: string; locale: string; recording_disclosure_enabled: boolean; recording_disclosure_text: string; recording_retention_days: number; data_region: string; booking_capacity: number; transfer_phone: string | null }
export interface Agent { id: string; name: string; status: "draft" | "live" | "paused"; language: string; voice_id: string; greeting: string; created_by: string | null; created_at: string }
export interface AuditEntry { id: string; actor_user_id: string | null; action: string; target_type: string | null; target_id: string | null; details: Record<string, unknown>; created_at: string }
export interface UsageSummary { month: string; live: Record<string, string>; simulated: Record<string, string>; event_count: number }

export const PERMS: Record<Role, { write: boolean; members: boolean; owner: boolean; audit: boolean; knowledge: boolean; desk: boolean }> = {
  owner: { write: true, members: true, owner: true, audit: true, knowledge: true, desk: true },
  admin: { write: true, members: true, owner: false, audit: true, knowledge: true, desk: true },
  manager: { write: false, members: false, owner: false, audit: false, knowledge: true, desk: true },
  staff: { write: false, members: false, owner: false, audit: false, knowledge: false, desk: true },
  viewer: { write: false, members: false, owner: false, audit: false, knowledge: false, desk: false },
};

export const ROLE_LABEL: Record<Role, string> = { owner: "Owner", admin: "Admin", manager: "Manager", staff: "Staff (front desk)", viewer: "Viewer" };

// ---- reception desk ----
export type CaseKind = "message" | "transfer" | "callback";
export type CaseStatus = "new" | "in_progress" | "resolved";
export type DeskStatus = "offline" | "available" | "busy";
export interface CaseNote { id: string; author_id: string | null; author_name: string | null; body: string; created_at: string }
export interface DeskCase {
  id: string; kind: CaseKind; caller_name: string | null; caller_phone: string | null; summary: string; reason: string | null;
  urgent: boolean; status: CaseStatus; source: string; assigned_to: string | null; assignee_name: string | null; assigned_at: string | null;
  resolution: string | null; resolved_at: string | null; resolved_by: string | null; created_at: string; updated_at: string; notes?: CaseNote[];
}
export interface DeskMember { user_id: string; full_name: string; role: Role; status: DeskStatus; status_since: string | null; open_cases: number }
export interface Appointment { id: string; service_id: string | null; service_name: string; starts_at: string; ends_at: string; customer_name: string; customer_phone: string; notes: string | null; status: "booked" | "cancelled"; source: string; created_at: string }
