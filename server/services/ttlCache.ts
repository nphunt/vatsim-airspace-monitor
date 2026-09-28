export interface Cached<T> {
  value: T;
  /** Local ms when the value was loaded. */
  fetchedAt: number;
  /** True when the reload failed and an expired value was served instead. */
  stale: boolean;
}

export interface TtlCacheOptions<T> {
  ttlMs: number;
  load: (key: string) => Promise<T>;
  maxEntries?: number;
  now?: () => number;
}

/**
 * Keyed cache for slow-changing upstream data. Concurrent misses for one key share a
 * single load, and a failed reload serves the expired value (stale-if-error) rather than
 * failing the request. Oldest entries are evicted beyond maxEntries.
 */
export class TtlCache<T> {
  private readonly entries = new Map<string, { value: T; fetchedAt: number }>();
  private readonly inflight = new Map<string, Promise<Cached<T>>>();
  private readonly opts: TtlCacheOptions<T>;
  private readonly now: () => number;

  constructor(opts: TtlCacheOptions<T>) {
    this.opts = opts;
    this.now = opts.now ?? Date.now;
  }

  get(key: string): Promise<Cached<T>> {
    const hit = this.entries.get(key);
    if (hit && this.now() - hit.fetchedAt < this.opts.ttlMs) {
      return Promise.resolve({ ...hit, stale: false });
    }
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const p = this.reload(key, hit).finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  private async reload(key: string, old: { value: T; fetchedAt: number } | undefined) {
    try {
      const entry = { value: await this.opts.load(key), fetchedAt: this.now() };
      this.entries.delete(key); // re-insert so Map order is age order
      this.entries.set(key, entry);
      const max = this.opts.maxEntries ?? 100;
      while (this.entries.size > max) this.entries.delete(this.entries.keys().next().value!);
      return { ...entry, stale: false };
    } catch (e) {
      if (old) return { ...old, stale: true };
      throw e;
    }
  }
}
