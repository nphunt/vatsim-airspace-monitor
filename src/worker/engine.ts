import { FALLBACK_FEED_URL, HORIZON_MIN, UI_TICK_MS } from "../config";
import { ServerOffsetEstimator, createLiveClock, type Clock } from "../core/clock";
import { buildStaffing } from "../core/facilityLookup";
import { MyPositionTracker, findMyPosition } from "../core/myPosition";
import {
  computePredictions,
  selectAirspace,
  type AirportIndex,
  type SelectedAirspace,
} from "../core/pipeline";
import { TrackStore } from "../core/track";
import { loadAirspaces, type AirspaceRegistry } from "../data/airspaces";
import { FeedPoller, type FeedStatus } from "../data/feed";
import { dataUrl } from "../data/paths";
import type { FeedSnapshot } from "../data/types";
import type { EngineConfig, FromEngine, InitMessage, ToEngine } from "./protocol";
import type { ReplayFeed } from "./replay";

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

export const DEFAULT_CONFIG: EngineConfig = {
  horizonMin: HORIZON_MIN,
  myCid: null,
  autoSelect: true,
};

/**
 * The worker-side engine (§4.3): owns the feed (live polling or dev replay), the clock,
 * track history, My Position and the prediction pipeline. Runs in a dedicated worker so
 * polling and the 1 Hz tick keep going when the page is covered by CRC.
 */
export class Engine {
  private readonly fetchImpl: typeof fetch;
  private readonly setIntervalFn: (fn: () => void, ms: number) => unknown;
  private readonly clearIntervalFn: (handle: unknown) => void;
  private readonly localNow: () => number;
  private readonly post: (m: FromEngine) => void;

  readonly estimator = new ServerOffsetEstimator();
  /** Live (server-corrected) until a replay recording loads, then its virtual clock. */
  clock: Clock;
  private poller: FeedPoller | null = null;
  private replay: ReplayFeed | null = null;
  private tickHandle: unknown = null;
  private started = false;

  config: EngineConfig = { ...DEFAULT_CONFIG };
  airspaces: AirspaceRegistry | null = null;
  airports: AirportIndex = {};
  snapshot: FeedSnapshot | null = null;
  readonly tracks = new TrackStore();
  private selected: SelectedAirspace | null = null;
  /** A selection that arrived before the boundary data finished loading. */
  private pendingSelect: string | null = null;
  private readonly myPosition = new MyPositionTracker();

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
        return this.init(msg);
      case "select":
        this.select(msg.airspace);
        return Promise.resolve();
      case "config":
        this.setConfig(msg.config);
        return Promise.resolve();
      case "replayRate":
        this.replay?.setRate(msg.rate);
        this.tick();
        return Promise.resolve();
    }
  }

  private get rate(): number {
    return this.replay?.clock?.getRate() ?? 1;
  }

  private async init(msg: InitMessage): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.config = { ...msg.config };
    const base = msg.dataBaseUrl;

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

    // Load boundary data before feeding snapshots, so the first one is fully processed.
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
    this.post({
      type: "ready",
      selectableCount: this.airspaces?.getSelectableAirspaces().length ?? 0,
      selectable: (this.airspaces?.getSelectableAirspaces() ?? []).map((a) => ({
        key: a.key,
        id: a.id,
        label: a.label,
        name: a.name,
        group: a.group!,
      })),
      vatspyTag: meta.vatspy?.tag ?? null,
      feedUrl,
    });
    if (this.pendingSelect) this.select(this.pendingSelect);

    // The replay module is dev-only. The import must sit inside this dead-in-production
    // branch (not in a method) for the bundler to drop it from the build.
    if (import.meta.env.DEV && msg.replay) {
      const { ReplayFeed } = await import("./replay");
      await this.startReplay(
        new ReplayFeed({
          ...msg.replay,
          fetchImpl: this.fetchImpl,
          localNow: this.localNow,
          setInterval: this.setIntervalFn,
          clearInterval: this.clearIntervalFn,
          onSnapshot: (s) => this.onSnapshot(s),
          onPoll: (feed) => this.postPoll(feed),
        }),
      );
      return;
    }
    // Poll even if boundaries failed: the DATA indicator is still useful.
    this.poller = new FeedPoller({
      url: feedUrl,
      estimator: this.estimator,
      fetchImpl: this.fetchImpl,
      localNow: this.localNow,
      onSnapshot: (s) => this.onSnapshot(s),
      onPoll: (feed) => this.postPoll(feed),
    });
    this.poller.start();
  }

  private async startReplay(replay: ReplayFeed): Promise<void> {
    try {
      await replay.load();
    } catch (e) {
      this.error(String(e));
      return;
    }
    this.replay = replay;
    this.clock = replay.clock!;
    replay.start();
    this.tick();
  }

  private onSnapshot(s: FeedSnapshot): void {
    this.snapshot = s;
    // History is kept for every pilot in the track region, whatever is selected.
    this.tracks.update(s);
    const autoSelected = this.updateStatus();
    if (autoSelected) this.select(autoSelected);
    else this.recompute();
  }

  /** Posts staffing + My Position for the latest snapshot; returns a key to auto-select. */
  private updateStatus(): string | null {
    if (!this.snapshot || !this.airspaces) return null;
    const registry = this.airspaces;
    const staffing = buildStaffing(this.snapshot.controllers, registry, (k) =>
      registry.getAirspace(k),
    );
    const me =
      this.config.myCid === null
        ? null
        : findMyPosition(this.snapshot.controllers, this.config.myCid, registry);
    const transition = this.myPosition.update(me);
    const autoSelected =
      transition && this.config.autoSelect && transition !== this.selected?.airspace.key
        ? transition
        : null;
    this.post({ type: "status", staffed: [...staffing.keys()], myPosition: me, autoSelected });
    return autoSelected;
  }

  private postPoll(feed: FeedStatus): void {
    this.post({
      type: "poll",
      feed,
      pilots: this.snapshot?.pilots.length ?? 0,
      controllers: this.snapshot?.controllers.length ?? 0,
      now: this.clock.now(),
      rate: this.rate,
    });
  }

  private setConfig(config: EngineConfig): void {
    const cidChanged = config.myCid !== this.config.myCid;
    const horizonChanged = config.horizonMin !== this.config.horizonMin;
    this.config = { ...config };
    if (cidChanged) {
      // Re-evaluate at once, so entering a CID while logged on auto-selects immediately.
      this.myPosition.reset();
      const autoSelected = this.updateStatus();
      if (autoSelected) {
        this.select(autoSelected);
        return;
      }
    }
    if (horizonChanged) this.recompute();
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

  /** Recomputes from the latest snapshot: per new snapshot, on switch, on horizon change. */
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
        horizonMin: this.config.horizonMin,
      });
      this.post({ type: "predictions", set });
    } catch (e) {
      this.error(`prediction failed: ${String(e)}`);
    }
  }

  private tick(): void {
    this.post({
      type: "tick",
      now: this.clock.now(),
      rate: this.rate,
      replay: this.replay?.status() ?? null,
    });
  }

  private error(message: string): void {
    console.error(`[engine] ${message}`);
    this.post({ type: "error", message });
  }

  stop(): void {
    this.poller?.stop();
    this.replay?.stop();
    if (this.tickHandle !== null) this.clearIntervalFn(this.tickHandle);
    this.tickHandle = null;
  }
}
