// Where to send someone after signing in at /start. Only same-site pages of the app are
// accepted, so a crafted ?next= link can never redirect a visitor to another site.

const ALLOWED = ["/start/design", "/command", "/atelier", "/flow"];

export function safeNext(raw: string | null | undefined): string | null {
  if (!raw || raw.length > 200) return null;
  // Must be a plain absolute path on this site: no scheme, no "//host", no backslashes.
  if (!raw.startsWith("/") || raw.startsWith("//") || /[\\\s]/.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw, "https://voxera.invalid");
  } catch {
    return null;
  }
  if (url.origin !== "https://voxera.invalid") return null;
  const path = url.pathname;
  const ok = ALLOWED.some((p) => path === p || path.startsWith(`${p}/`));
  return ok ? path + url.search : null;
}

/** The sign-in link for a page that needs a session, returning there afterwards. */
export const signInHref = (next: string) => `/start?next=${encodeURIComponent(next)}`;
