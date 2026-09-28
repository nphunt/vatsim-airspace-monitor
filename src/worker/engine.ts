import {
  EXIT_ALERT_S,
  FALLBACK_FEED_URL,
  HORIZON_MIN,
  LOAD_STRATEGIC_MIN,
  UI_TICK_MS,
} from "../config";
import { AlertMachine, DEFAULT_ALERT_CONFIG, type AlertConfig } from "../core/alerts";
import { ServerOffsetEstimator, createLiveClock, type Clock } from "../core/clock";
import { altitudeFilterFt, filterByAltitude } from "../core/altitudeFilter";
import { buildStaffing } from "../core/facilityLookup";
import { MyPositionTracker, findMyPosition } from "../core/myPosition";
import {
  computePredictions,
  eligiblePilots,
  selectAirspace,
  type AirportIndex,
  type SelectedAirspace,
} from "../core/pipeline";
import type { NavData, Procedure } from "../core/route";
import { RouteModeTracker } from "../core/routeMode";
import { TrackStore } from "../core/track";
import { loadAirspaces, type AirspaceRegistry } from "../data/airspaces";
import { FeedPoller, type FeedStatus } from "../data/feed";
import { dataUrl } from "../data/paths";
import type { FeedSnapshot, PredictionSet } from "../data/types";
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
  repeatTone: false,
  entryAlerts: false,
  loadOpen: false,
  scopeOpen: false,
  alertThresholdS: EXIT_ALERT_S,
  altFloor: null,
  altCeiling: null,
};

/** Prediction horizon: the list horizon, or the load horizon while LOAD is open (§5.2). */
export function effectiveHorizonMin(c: EngineConfig): number {
  return c.loadOpen ? Math.max(c.horizonMin, LOAD_STRATEGIC_MIN) : c.horizonMin;
}

/** Repeat interval when the repeat-tone setting is on (§6.1). */
const REPEAT_TONE_S = 30;

function alertConfig(c: EngineConfig): AlertConfig {
  return {
    ...DEFAULT_ALERT_CONFIG,
    repeatToneS: c.repeatTone ? REPEAT_TONE_S : null,
    entryAlerts: c.entryAlerts,
    exitAlertS: c.alertThresholdS,
    entryAlertS: c.alertThresholdS,
  };
}

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
  private paused = false;

  config: EngineConfig = { ...DEFAULT_CONFIG };
  airspaces: AirspaceRegistry | null = null;
  airports: AirportIndex = {};
  snapshot: FeedSnapshot | null = null;
  readonly tracks = new TrackStore();
  private selected: SelectedAirspace | null = null;
  /** A selection that arrived before the boundary data finished loading. */
  private pendingSelect: string | null = null;
  private readonly myPosition = new MyPositionTracker();
  readonly alerts = new AlertMachine();
  /** Route-following state; null until nav data loads (then predictions start using it). */
  routes: RouteModeTracker | null = null;
  private lastSet: PredictionSet | null = null;
  private eligibleCids: ReadonlySet<number> = new Set();

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
      case "ack":
        if (msg.cid === null ? this.alerts.ackAll() : this.alerts.ack(msg.cid))
          this.postAlerts(false);
        return Promise.resolve();
      case "pause":
        this.setPaused(msg.paused);
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
    this.alerts.config = alertConfig(this.config);
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
    // Nav data is large; load it in the background. Until then everything is DR (§3.3).
    void this.loadNav(base);

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
    // Replay start primes silently like a page load (§6.1).
    this.alerts.reset();
    replay.start();
    this.tick();
  }

  private async loadNav(base: string): Promise<void> {
    try {
      const get = async <T>(name: string): Promise<T> => {
        const res = await this.fetchImpl(dataUrl(`nav/${name}`, base));
        if (!res.ok) throw new Error(`nav/${name} -> ${res.status}`);
        return (await res.json()) as T;
      };
      const [points, airways, procedures, meta] = await Promise.all([
        get<NavData["points"]>("points.json"),
        get<NavData["airways"]>("airways.json"),
        get<{ sids: Record<string, Procedure>; stars: Record<string, Procedure> }>(
          "procedures.json",
        ),
        get<{ cycle?: string; expires?: string }>("meta.json"),
      ]);
      const nav: NavData = { points, airways, sids: procedures.sids, stars: procedures.stars };
      this.routes = new RouteModeTracker(nav, (icao) => {
        const a = this.airports[icao];
        return a ? { lat: a[0], lon: a[1] } : undefined;
      });
      this.post({
        type: "nav",
        cycle: meta.cycle ?? null,
        expires: meta.expires ?? null,
        error: null,
      });
      if (this.snapshot) {
        this.routes.update(this.snapshot.pilots, this.tracks);
        this.recompute();
      }
    } catch (e) {
      this.post({ type: "nav", cycle: null, expires: null, error: String(e) });
      this.error(`nav data failed to load; predictions stay dead reckoning: ${String(e)}`);
    }
  }

  private onSnapshot(s: FeedSnapshot): void {
    this.snapshot = s;
    // History and RTE/DR state are kept for every pilot in the track region, whatever is
    // selected, so a switch never starts from scratch (§4.2).
    this.tracks.update(s);
    this.routes?.update(s.pilots, this.tracks);
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
    const horizonChanged =
      effectiveHorizonMin(config) !== effectiveHorizonMin(this.config) ||
      config.loadOpen !== this.config.loadOpen ||
      config.scopeOpen !== this.config.scopeOpen ||
      config.altFloor !== this.config.altFloor ||
      config.altCeiling !== this.config.altCeiling;
    this.config = { ...config };
    this.alerts.config = alertConfig(this.config);
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

  /** Idle stop: live polling only (a dev replay keeps its own controls). */
  private setPaused(paused: boolean): void {
    if (paused === this.paused || this.replay) return;
    this.paused = paused;
    if (paused) {
      this.poller?.stop();
      this.lastSet = null;
      this.alerts.reset();
      this.post({ type: "predictions", set: null });
      this.postAlerts(false);
    } else {
      // The old snapshot is up to 4 h stale: drop it; the immediate poll brings a new one.
      this.snapshot = null;
      this.tracks.clear();
      this.routes?.clear();
      this.alerts.reset();
      this.poller?.start();
    }
  }

  private select(idOrKey: string | null): void {
    if (idOrKey === null) {
      this.selected = null;
      this.lastSet = null;
      this.alerts.reset();
      this.post({ type: "predictions", set: null });
      this.postAlerts(false);
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
    // A switch resets alerts and primes silently (§4.2, §6.1).
    this.alerts.reset();
    this.lastSet = null;
    this.recompute();
  }

  /** Recomputes from the latest snapshot: per new snapshot, on switch, on horizon change. */
  private recompute(): void {
    if (!this.selected || !this.snapshot || !this.airspaces || this.paused) return;
    try {
      const now = this.clock.now();
      const set = computePredictions({
        snapshot: this.snapshot,
        selected: this.selected,
        registry: this.airspaces,
        airports: this.airports,
        tracks: this.tracks,
        now,
        horizonMin: effectiveHorizonMin(this.config),
        routes: this.routes,
        load: this.config.loadOpen ? { altitude: altitudeFilterFt(this.config) } : null,
        scope: this.config.scopeOpen,
      });
      // The altitude filter applies to display, alerts and load, not prediction (§5.7).
      // Load gets it above; lists, alerts and scope targets here.
      const shown = filterByAltitude(set, altitudeFilterFt(this.config));
      this.lastSet = shown;
      this.eligibleCids = new Set(eligiblePilots(this.snapshot.pilots, now).map((p) => p.cid));
      this.post({ type: "predictions", set: shown });
      this.evaluateAlerts(true);
    } catch (e) {
      this.error(`prediction failed: ${String(e)}`);
    }
  }

  /** Runs the alert state machine; posts on change or tone (§6.1). */
  private evaluateAlerts(forcePost = false): void {
    if (!this.lastSet) return;
    const r = this.alerts.evaluate({
      set: this.lastSet,
      eligibleCids: this.eligibleCids,
      now: this.clock.now(),
    });
    if (r.changed || r.tone || forcePost) this.postAlerts(r.tone);
  }

  private postAlerts(tone: boolean): void {
    this.post({ type: "alerts", alerts: this.alerts.list(), tone });
  }

  private tick(): void {
    // The 1 Hz alert evaluation lives here, in the worker, so it keeps running while the
    // page is covered and its main-thread timers are throttled (§4.3).
    this.evaluateAlerts();
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
