import { API_URL } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export function GET() {
  if (process.env.VERCEL_ENV !== "preview" || process.env.VERCEL_GIT_COMMIT_REF !== "staging") {
    return new Response(null, { status: 404 });
  }

  // Report only a boolean. A misconfigured upstream URL could contain credentials.
  return Response.json({
    commit: process.env.VERCEL_GIT_COMMIT_SHA,
    usesStagingApi: API_URL === "https://voxera-api-git-staging-ai-e399.vercel.app",
  }, { headers: { "Cache-Control": "no-store" } });
}
