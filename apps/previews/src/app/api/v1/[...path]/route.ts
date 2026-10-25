import { NextRequest, NextResponse } from "next/server";
import { ACCESS_COOKIE, API_URL, REFRESH_COOKIE, clearSessionCookies, csrfOk, refreshOnce, setSessionCookies, type Tokens } from "@/lib/server/session";

export const dynamic = "force-dynamic";

// Paths the browser may reach through this proxy. Auth endpoints are only reachable via /api/session.
const ALLOWED = /^(me(\/.*)?|orgs(\/.*)?|invitations\/accept)$/;

async function handle(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const sub = path.join("/");
  if (!ALLOWED.test(sub) || path.some((p) => p === ".." || p === ".")) return NextResponse.json({ detail: "Not found" }, { status: 404 });
  if (!csrfOk(req)) return NextResponse.json({ detail: "CSRF check failed" }, { status: 403 });

  const body = ["GET", "HEAD"].includes(req.method) ? undefined : await req.text();
  const url = `${API_URL}/v1/${sub}${req.nextUrl.search}`;
  const call = (token: string | undefined) =>
    fetch(url, {
      method: req.method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
        "user-agent": req.headers.get("user-agent") ?? "voxera-web",
        "x-request-id": req.headers.get("x-request-id") ?? crypto.randomUUID(),
      },
      body,
      cache: "no-store",
    });

  let fresh: Tokens | null = null;
  let r = await call(req.cookies.get(ACCESS_COOKIE)?.value);
  if (r.status === 401) {
    const rt = req.cookies.get(REFRESH_COOKIE)?.value;
    if (rt) {
      fresh = await refreshOnce(rt);
      if (fresh) r = await call(fresh.access_token);
    }
  }
  const res = new NextResponse(r.status === 204 ? null : await r.arrayBuffer(), {
    status: r.status,
    headers: { "content-type": r.headers.get("content-type") ?? "application/json", "x-request-id": r.headers.get("x-request-id") ?? "" },
  });
  if (fresh) setSessionCookies(res, fresh);
  if (r.status === 401) clearSessionCookies(res);
  return res;
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
