import { create } from "zustand";
import type { FeedStatus } from "../data/feed";
import type { FromEngine, ReadyMessage } from "../worker/protocol";

export interface EngineView {
  /** Local ms when the engine was started; the watchdog's reference before any message. */
  startedAt: number | null;
  /** Local ms of the last message from the worker. */
  lastMessageAt: number | null;
  ready: ReadyMessage | null;
  feed: FeedStatus | null;
  pilots: number;
  controllers: number;
  serverOffsetMs: number;
  errors: string[];
}

interface AppState {
  engine: EngineView;
  engineStarted(localNow: number): void;
  engineMessage(msg: FromEngine, localNow: number): void;
}

const initialEngine: EngineView = {
  startedAt: null,
  lastMessageAt: null,
  ready: null,
  feed: null,
  pilots: 0,
  controllers: 0,
  serverOffsetMs: 0,
  errors: [],
};

export const useStore = create<AppState>()((set) => ({
  engine: initialEngine,

  engineStarted: (localNow) => set({ engine: { ...initialEngine, startedAt: localNow } }),

  engineMessage: (msg, localNow) =>
    set((s) => {
      const e: EngineView = { ...s.engine, lastMessageAt: localNow };
      switch (msg.type) {
        case "tick":
          e.serverOffsetMs = msg.serverOffsetMs;
          break;
        case "poll":
          // Take the offset from the poll too: the first snapshot must not be shown against
          // an uncorrected clock until the next tick arrives.
          e.serverOffsetMs = msg.feed.serverOffsetMs;
          e.feed = msg.feed;
          e.pilots = msg.pilots;
          e.controllers = msg.controllers;
          break;
        case "ready":
          e.ready = msg;
          break;
        case "error":
          e.errors = [...e.errors, msg.message].slice(-10);
          break;
      }
      return { engine: e };
    }),
}));
