import { FALLBACK_FEED_URL, UI_TICK_MS } from "../config";
import { ServerOffsetEstimator, createLiveClock, type Clock } from "../core/clock";
import { loadAirspaces, type AirspaceRegistry } from "../data/airspaces";
import { FeedPoller } from "../data/feed";
import { dataUrl } from "../data/paths";
import type { FeedSnapshot } from "../data/types";
import type { FromEngine, ToEngine } from "./protocol";

export interface EngineDeps {
  fetchImpl?: typeof fetch;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
  localNow?: () => number;
}

interface DataMeta {
  vatspy?: { tag?: string };
  feedUrl?: string;
}

/** Only ever poll VATSIM's own data host, whatever meta.json says. */
function safeFeedUrl(url: unknown): string {
  return typeof url === "string" && url.startsWith("https://data.vatsim.net/")
    ? url
    : FALLBACK_FEED_URL;
}

/**
 * The worker-side engine (§4.3): owns feed polling, the clock and (from M3) the core
 * pipeline. Runs in a dedicated worker so polling and the 1 Hz tick keep going when the
 * page is covered by CRC and the main thread is throttled.
 */
export class Engine {
  private readonly fetchImpl: typeof fetch;
  private readonly setIntervalFn: (fn: () => void, ms: number) => unknown;
  private readonly clearIntervalFn: (handle: unknown) => void;
  private readonly localNow: () => number;

  readonly estimator = new ServerOffsetEstimator();
  readonly clock: Clock;
  private poller: FeedPoller | null = null;
  private tickHandle: unknown = null;
  private started = false;

  airspaces: AirspaceRegistry | null = null;
  snapshot: FeedSnapshot | null = null;

  private readonly post: (m: FromEngine) => void;

  constructor(post: (m: FromEngine) => void, deps: EngineDeps = {}) {
    this.post = post;
    this.fetchImpl = deps.fetchImpl ?? ((...args) => fetch(...args));
    this.setIntervalFn = deps.setInterval ?? ((fn, ms) => setInterval(fn, ms));
    this.clearIntervalFn =
      deps.clearInterval ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>));
    this.localNow = deps.localNow ?? Date.now;
    this.clock = createLiveClock(this.estimator, this.localNow);
  }

  handle(msg: ToEngine): Promise<void> {
    switch (msg.type) {
      case "init":
        return this.init(msg.dataBaseUrl);
    }
  }

  private async init(base: string): Promise<void> {
    if (this.started) return;
    this.started = true;

    // Tick first, so the watchdog sees a live worker even while data is loading.
    this.tickHandle = this.setIntervalFn(() => this.tick(), UI_TICK_MS);
    this.tick();

    let meta: DataMeta = {};
    try {
      meta = (await (await this.fetchImpl(dataUrl("meta.json", base))).json()) as DataMeta;
    } catch (e) {
      this.error(`meta.json failed to load: ${String(e)}`);
    }
    const feedUrl = safeFeedUrl(meta.feedUrl);

    // Poll even if boundaries fail: the DATA indicator is still useful.
    this.poller = new FeedPoller({
      url: feedUrl,
      estimator: this.estimator,
      fetchImpl: this.fetchImpl,
      localNow: this.localNow,
      onSnapshot: (s) => {
        this.snapshot = s;
      },
      onPoll: (feed) =>
        this.post({
          type: "poll",
          feed,
          pilots: this.snapshot?.pilots.length ?? 0,
          controllers: this.snapshot?.controllers.length ?? 0,
        }),
    });
    this.poller.start();

    try {
      this.airspaces = await loadAirspaces({ base, fetchImpl: this.fetchImpl });
    } catch (e) {
      this.error(`boundary data failed to load: ${String(e)}`);
    }
    this.post({
      type: "ready",
      selectableCount: this.airspaces?.getSelectableAirspaces().length ?? 0,
      vatspyTag: meta.vatspy?.tag ?? null,
      feedUrl,
    });
  }

  private tick(): void {
    this.post({ type: "tick", now: this.clock.now(), serverOffsetMs: this.estimator.offset() });
  }

  private error(message: string): void {
    console.error(`[engine] ${message}`);
    this.post({ type: "error", message });
  }

  stop(): void {
    this.poller?.stop();
    if (this.tickHandle !== null) this.clearIntervalFn(this.tickHandle);
    this.tickHandle = null;
  }
}
