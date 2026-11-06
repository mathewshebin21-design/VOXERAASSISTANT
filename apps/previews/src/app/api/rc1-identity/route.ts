import { API_URL } from "@/lib/server/session";

export const dynamic = "force-dynamic";

const RC1_API = "https://voxera-api-git-codex-rc1-validation-ai-e399.vercel.app";

export function GET() {
  if (process.env.VERCEL_ENV !== "preview" || process.env.VERCEL_GIT_COMMIT_REF !== "codex/rc1-validation") {
    return new Response(null, { status: 404 });
  }

  // Report only a boolean. A misconfigured upstream URL could contain credentials.
  return Response.json({
    commit: process.env.VERCEL_GIT_COMMIT_SHA,
    usesRc1Api: API_URL === RC1_API,
  }, { headers: { "Cache-Control": "no-store" } });
}
