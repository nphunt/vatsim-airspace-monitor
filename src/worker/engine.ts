import { FALLBACK_FEED_URL, HORIZON_MIN, UI_TICK_MS } from "../config";
import { ServerOffsetEstimator, createLiveClock, type Clock } from "../core/clock";
import {
  computePredictions,
  selectAirspace,
  type AirportIndex,
  type SelectedAirspace,
} from "../core/pipeline";
import { TrackStore } from "../core/track";
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
 * The worker-side engine (§4.3): owns feed polling, the clock, track history and the core
 * prediction pipeline. Runs in a dedicated worker so polling and the 1 Hz tick keep going when the
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
  airports: AirportIndex = {};
  snapshot: FeedSnapshot | null = null;
  readonly tracks = new TrackStore();
  private selected: SelectedAirspace | null = null;
  /** A selection that arrived before the boundary data finished loading. */
  private pendingSelect: string | null = null;
  horizonMin = HORIZON_MIN;

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
      case "select":
        this.select(msg.airspace);
        return Promise.resolve();
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
        // History is kept for every pilot in the track region, whatever is selected.
        this.tracks.update(s);
        this.recompute();
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
      [this.airspaces, this.airports] = await Promise.all([
        loadAirspaces({ base, fetchImpl: this.fetchImpl }),
        this.fetchImpl(dataUrl("airports.json", base)).then(
          (r) => r.json() as Promise<AirportIndex>,
        ),
      ]);
    } catch (e) {
      this.error(`boundary data failed to load: ${String(e)}`);
    }
    if (this.pendingSelect) this.select(this.pendingSelect);
    this.post({
      type: "ready",
      selectableCount: this.airspaces?.getSelectableAirspaces().length ?? 0,
      vatspyTag: meta.vatspy?.tag ?? null,
      feedUrl,
    });
  }

  private select(idOrKey: string | null): void {
    if (idOrKey === null) {
      this.selected = null;
      this.post({ type: "predictions", set: null });
      return;
    }
    if (!this.airspaces) {
      this.pendingSelect = idOrKey;
      return;
    }
    this.pendingSelect = null;
    const a =
      this.airspaces.getAirspace(idOrKey) ??
      this.airspaces.getSelectableAirspaces().find((x) => x.label === idOrKey.toUpperCase());
    if (!a?.selectable) {
      this.error(`unknown airspace ${idOrKey}`);
      return;
    }
    this.selected = selectAirspace(a);
    this.recompute();
  }

  /** Recomputes from the latest snapshot. Called per new snapshot and on switch (§4.2). */
  private recompute(): void {
    if (!this.selected || !this.snapshot || !this.airspaces) return;
    try {
      const set = computePredictions({
        snapshot: this.snapshot,
        selected: this.selected,
        registry: this.airspaces,
        airports: this.airports,
        tracks: this.tracks,
        now: this.clock.now(),
        horizonMin: this.horizonMin,
      });
      this.post({ type: "predictions", set });
    } catch (e) {
      this.error(`prediction failed: ${String(e)}`);
    }
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
