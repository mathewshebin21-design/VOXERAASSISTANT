import "server-only";

// Backend-for-frontend session handling.
// The browser never sees API tokens: they live in httpOnly cookies set by these
// Next.js route handlers, which forward requests to the VOXERA API with a Bearer token.

import { createHash } from "crypto";
import type { NextRequest, NextResponse } from "next/server";

export const API_URL = (process.env.VOXERA_API_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");
export const ACCESS_COOKIE = "vx_at";
export const REFRESH_COOKIE = "vx_rt";
const secure = process.env.NODE_ENV === "production";

export interface Tokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export function setSessionCookies(res: NextResponse, t: Tokens) {
  res.cookies.set(ACCESS_COOKIE, t.access_token, { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: t.expires_in });
  res.cookies.set(REFRESH_COOKIE, t.refresh_token, { httpOnly: true, sameSite: "strict", secure, path: "/api", maxAge: 60 * 60 * 24 * 30 });
}

export function clearSessionCookies(res: NextResponse) {
  res.cookies.set(ACCESS_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  res.cookies.set(REFRESH_COOKIE, "", { httpOnly: true, path: "/api", maxAge: 0 });
}

/**
 * CSRF defence for cookie-authenticated mutations: require a custom header (which a
 * cross-site form or <img> cannot send without a CORS preflight these routes never
 * grant) and, when the browser sends Origin, require it to match this host.
 */
export function csrfOk(req: NextRequest): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return true;
  if (req.headers.get("x-voxera-csrf") !== "1") return false;
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.get("host");
  } catch {
    return false;
  }
}

// Concurrent requests that all find an expired access token must share ONE refresh:
// the API treats reuse of a rotated refresh token as theft and revokes the session.
const inflight = new Map<string, { at: number; p: Promise<Tokens | null> }>();

export function refreshOnce(refreshToken: string): Promise<Tokens | null> {
  const key = createHash("sha256").update(refreshToken).digest("hex");
  const now = Date.now();
  for (const [k, v] of inflight) if (now - v.at > 30_000) inflight.delete(k);
  const hit = inflight.get(key);
  if (hit) return hit.p;
  const p = fetch(`${API_URL}/v1/auth/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
    cache: "no-store",
  }).then(async (r) => (r.ok ? ((await r.json()) as Tokens) : null)).catch(() => null);
  inflight.set(key, { at: now, p });
  return p;
}
