import { NextRequest, NextResponse } from "next/server";
import { ACCESS_COOKIE, API_URL, REFRESH_COOKIE, clearSessionCookies, csrfOk, refreshOnce, setSessionCookies, type Tokens } from "@/lib/server/session";

export const dynamic = "force-dynamic";

async function forward(path: string, body: unknown, req: NextRequest) {
  return fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": req.headers.get("user-agent") ?? "voxera-web", "x-forwarded-for": req.headers.get("x-forwarded-for") ?? "" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
}

/** POST /api/session/{login|signup|logout} */
export async function POST(req: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  if (!csrfOk(req)) return NextResponse.json({ detail: "CSRF check failed" }, { status: 403 });
  if (action === "logout") {
    const at = req.cookies.get(ACCESS_COOKIE)?.value;
    if (at) await fetch(`${API_URL}/v1/auth/logout`, { method: "POST", headers: { authorization: `Bearer ${at}` } }).catch(() => undefined);
    const res = new NextResponse(null, { status: 204 });
    clearSessionCookies(res);
    return res;
  }
  if (action !== "login" && action !== "signup") return NextResponse.json({ detail: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  const r = await forward(`/v1/auth/${action}`, body, req);
  const data = await r.json().catch(() => ({ detail: "Unexpected response" }));
  if (!r.ok) return NextResponse.json(data, { status: r.status });
  const res = NextResponse.json({ ok: true }, { status: r.status });
  setSessionCookies(res, data as Tokens);
  return res;
}

/** GET /api/session/me — who is signed in (refreshing the access token if needed).
 *  Being signed out is a normal state, so it returns 200 with { user: null } rather than 401. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  if (action !== "me") return NextResponse.json({ detail: "Not found" }, { status: 404 });
  let at = req.cookies.get(ACCESS_COOKIE)?.value;
  let fresh: Tokens | null = null;
  if (!at) {
    const rt = req.cookies.get(REFRESH_COOKIE)?.value;
    if (rt) fresh = await refreshOnce(rt);
    at = fresh?.access_token;
  }
  if (!at) return NextResponse.json({ user: null });
  const r = await fetch(`${API_URL}/v1/me`, { headers: { authorization: `Bearer ${at}` }, cache: "no-store" }).catch(() => null);
  if (!r) return NextResponse.json({ user: null, detail: "API unreachable" }, { status: 502 });
  if (r.status === 401) {
    const res = NextResponse.json({ user: null });
    clearSessionCookies(res);
    return res;
  }
  const res = NextResponse.json({ user: r.ok ? await r.json() : null }, { status: r.ok ? 200 : r.status });
  if (fresh) setSessionCookies(res, fresh);
  return res;
}
