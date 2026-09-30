/**
 * URL for a bundled file under public/data/.
 *
 * Always resolves against the app base (the site lives under /<repo>/ on Pages),
 * never a root-absolute "/data/...". The build id query busts the Pages
 * 10-minute cache after a data refresh (PUBLISHING_PLAN §2.2, §2.4).
 */
export function dataUrl(
  path: string,
  base: string = import.meta.env.BASE_URL,
  buildId: string = __BUILD_ID__,
): string {
  const cleanBase = base.endsWith("/") ? base : `${base}/`;
  const cleanPath = path.replace(/^\/+/, "");
  return `${cleanBase}data/${cleanPath}?v=${encodeURIComponent(buildId)}`;
}

/**
 * Absolute backend API base with a trailing slash, or null when there is no backend.
 * `configured` is VITE_API_BASE; in dev it defaults to "/api/" (the Vite proxy), and an
 * explicit empty value turns the backend off. Resolved here because relative URLs inside
 * the worker resolve against the worker script, not the page (PUBLISHING_PLAN §2.3).
 */
export function apiBaseUrl(
  configured: string | undefined,
  pageUrl: string,
  dev: boolean,
): string | null {
  const raw = configured ?? (dev ? "/api/" : "");
  if (!raw.trim()) return null;
  const url = new URL(raw.trim(), pageUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  url.search = "";
  url.hash = "";
  return url.href;
}
