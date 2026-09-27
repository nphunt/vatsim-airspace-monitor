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
