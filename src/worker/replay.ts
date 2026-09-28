// Replay source (§9.2): feeds recorded snapshots on a virtual clock instead of polling.
// Dev only: the engine imports this dynamically behind import.meta.env.DEV, so it is not
// in the production bundle.
import { ReplayClock } from "../core/clock";
import { normalizeFeed } from "../core/feedParse";
import type { FeedStatus } from "../data/feed";
import type { FeedSnapshot } from "../data/types";

export interface ReplayStatus {
  folder: string;
  rate: number;
  delivered: number;
  total: number;
  ended: boolean;
}

export interface ReplayFeedOptions {
  /** Absolute URL of the recording, ending in "/": serves index.json and each file. */
  baseUrl: string;
  rate: number;
  onSnapshot: (s: FeedSnapshot) => void;
  onPoll: (status: FeedStatus) => void;
  fetchImpl?: typeof fetch;
  localNow?: () => number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (h: unknown) => void;
}

interface ReplayIndex {
  folder: string;
  files: string[];
}

const PUMP_MS = 250;

export class ReplayFeed {
  clock: ReplayClock | null = null;
  private snapshots: FeedSnapshot[] = [];
  private next = 0;
  private folder = "";
  private handle: unknown = null;
  private readonly o: Required<ReplayFeedOptions>;

  constructor(opts: ReplayFeedOptions) {
    this.o = {
      fetchImpl: (...args) => fetch(...args),
      localNow: Date.now,
      setInterval: (fn, ms) => setInterval(fn, ms),
      clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
      ...opts,
    };
  }

  /** Loads the whole recording and anchors the clock at its first snapshot. */
  async load(): Promise<void> {
    const get = async (path: string) => {
      const res = await this.o.fetchImpl(new URL(path, this.o.baseUrl));
      if (!res.ok) throw new Error(`replay: GET ${path} -> ${res.status}`);
      return res.json() as Promise<unknown>;
    };
    const index = (await get("index.json")) as ReplayIndex;
    if (!index.files?.length) throw new Error("replay: recording has no snapshots");
    this.folder = index.folder;
    const docs = await Promise.all(index.files.map(get));
    this.snapshots = docs.map(normalizeFeed).sort((a, b) => a.updateTimestamp - b.updateTimestamp);
    this.clock = new ReplayClock(this.snapshots[0]!.updateTimestamp, this.o.rate, this.o.localNow);
  }

  start(): void {
    if (!this.clock) throw new Error("replay: load() first");
    this.pump();
    this.handle = this.o.setInterval(() => this.pump(), PUMP_MS);
  }

  stop(): void {
    if (this.handle !== null) this.o.clearInterval(this.handle);
    this.handle = null;
  }

  setRate(rate: number): void {
    this.clock?.setRate(rate);
  }

  /** Delivers every snapshot whose time has come on the virtual clock. */
  pump(): void {
    if (!this.clock) return;
    const now = this.clock.now();
    let delivered = false;
    while (this.next < this.snapshots.length && this.snapshots[this.next]!.updateTimestamp <= now) {
      this.o.onSnapshot(this.snapshots[this.next]!);
      this.next += 1;
      delivered = true;
    }
    if (delivered) this.o.onPoll(this.feedStatus());
    if (this.next >= this.snapshots.length) this.stop();
  }

  feedStatus(): FeedStatus {
    return {
      lastUpdateTimestamp: this.next > 0 ? this.snapshots[this.next - 1]!.updateTimestamp : null,
      serverOffsetMs: 0,
      consecutiveFailures: 0,
      lastError: null,
      nextPollAt: null,
      polls: [],
    };
  }

  status(): ReplayStatus {
    return {
      folder: this.folder,
      rate: this.clock?.getRate() ?? this.o.rate,
      delivered: this.next,
      total: this.snapshots.length,
      ended: this.snapshots.length > 0 && this.next >= this.snapshots.length,
    };
  }
}
