import { TtlCache, type Cached } from "./ttlCache.ts";
import { fetchUpstream } from "./upstream.ts";

export interface VnasOptions {
  baseUrl: string;
  userAgent: string;
  cacheMs: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/** "ZME", "zme" or "KZME" -> "ZME"; anything else -> null. */
export function normalizeArtccId(raw: string): string | null {
  const id = raw.toUpperCase().replace(/^K(?=Z[A-Z]{2}$)/, "");
  return /^Z[A-Z]{2}$/.test(id) ? id : null;
}

/**
 * vNAS ARTCC documents. vNAS sends no CORS header (SECTOR_PLAN §3.1), so the browser
 * cannot fetch them; the server does, and caches them because they change rarely.
 */
export class VnasService {
  private readonly cache: TtlCache<unknown>;

  constructor(opts: VnasOptions) {
    this.cache = new TtlCache({
      ttlMs: opts.cacheMs,
      now: opts.now,
      maxEntries: 32,
      load: async (id) => {
        const res = await fetchUpstream(`${opts.baseUrl}/api/artccs/${id}`, {
          userAgent: opts.userAgent,
          timeoutMs: 15_000,
          fetchImpl: opts.fetchImpl,
        });
        return (await res.json()) as unknown;
      },
    });
  }

  /** `id` must already be normalized. */
  artcc(id: string): Promise<Cached<unknown>> {
    return this.cache.get(id);
  }
}
