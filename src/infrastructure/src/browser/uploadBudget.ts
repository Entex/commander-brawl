/**
 * How much video a player sends, shared out across their links. Each player sends their camera separately to every
 * other player and every watcher, so four players and a watcher means four streams up from each computer: more than
 * many home connections can send at full quality. Without a shared limit, each stream finds out on its own that
 * there isn't room, and the camera's frames are dropped (1 to 5 fps) rather than the picture made smaller.
 */

/** What a link reports every few seconds about the video it sends. */
export interface SendSample {
  /** Bits per second sent just now. */
  readonly sentBps: number;
  /** Frames per second sent just now. */
  readonly fps: number;
  /** What's holding the video back, as WebRTC sees it: not enough room on the connection, or the computer. */
  readonly limitation: 'bandwidth' | 'cpu' | 'other' | null;
}

/** How a link should send right now. */
export interface SendPlan {
  readonly maxBitrateBps: number;
  /** 1: the camera's own size (at most 1080p); 1.5: 720p from 1080p; 2: 540p. */
  readonly scaleResolutionDownBy: number;
  readonly maxFramerate: number | undefined;
}

export interface UploadBudgetOptions {
  /** The most one player gets. */
  readonly playerBps: number;
  /** The most one watcher gets: they don't need video sharp enough for close-ups. */
  readonly watcherBps: number;
  readonly now?: () => number;
}

/** A watcher's picture is made this much smaller, and gets at most this many frames a second. */
const WATCHER_SCALE = 1.5;
const WATCHER_FPS = 20;
/** Never less than this for a link, however tight it gets: a picture at all. */
const MIN_LINK_BPS = 300_000;
/** When a link is held back by bandwidth, the budget is this share of what's getting through. */
const BACK_OFF = 0.9;
/** After this long without any link held back, the budget grows by this much, up to every link's full share. */
const CALM_MS = 20_000;
const GROW = 1.2;
/** Reports older than this are out of date. */
const FRESH_MS = 10_000;
/** Frames a second below which a link is struggling; this many reports in a row and its picture gets smaller. */
const LOW_FPS = 10;
const STRUGGLING_REPORTS = 3;
/** Frames a second at or above which it's fine; this many reports in a row and its picture gets bigger again. */
const GOOD_FPS = 20;
const RECOVERED_REPORTS = 10;
/** The sizes a struggling link steps down through, smaller each time. */
const SCALES = [1, 1.5, 2];

interface LinkState {
  readonly watcher: boolean;
  sample: SendSample | null;
  /** When it was reported. */
  at: number;
  /** Index into SCALES. */
  step: number;
  low: number;
  good: number;
}

/** One per player: shares out what they can send among their links. */
export class UploadBudget {
  private readonly links = new Map<object, LinkState>();
  /** What all the links together may send. Null: as much as each link's own limit. */
  private total: number | null = null;
  private calmSince: number;
  private readonly now: () => number;

  constructor(private readonly options: UploadBudgetOptions) {
    this.now = options.now ?? (() => Date.now());
    this.calmSince = this.now();
  }

  /** A link starts sending: to a player, or a watcher. */
  join(link: object, watcher: boolean): void {
    if (!this.links.has(link)) this.links.set(link, { watcher, sample: null, at: 0, step: 0, low: 0, good: 0 });
  }

  leave(link: object): void {
    this.links.delete(link);
  }

  /** What a link sent just now. Adjusts the budget, and the link's own picture size if it keeps struggling. */
  report(link: object, sample: SendSample): void {
    const state = this.links.get(link);
    if (!state) return;
    state.sample = sample;
    state.at = this.now();
    // Struggling for frames (whatever the reason): a smaller picture, so there are frames.
    if (sample.fps < LOW_FPS && sample.limitation !== null) {
      state.good = 0;
      if (++state.low >= STRUGGLING_REPORTS && state.step < SCALES.length - 1) {
        state.step++;
        state.low = 0;
      }
    } else if (sample.fps >= GOOD_FPS && sample.limitation === null) {
      state.low = 0;
      if (++state.good >= RECOVERED_REPORTS && state.step > 0) {
        state.step--;
        state.good = 0;
      }
    } else {
      state.low = 0;
      state.good = 0;
    }

    const all = [...this.links.values()];
    const full = all.reduce((sum, s) => sum + this.limitOf(s), 0);
    // What links reported lately: one that stopped sending (no camera) doesn't count.
    const fresh = all.filter((s) => s.sample !== null && this.now() - s.at <= FRESH_MS);
    if (fresh.some((s) => s.sample!.limitation === 'bandwidth')) {
      // Not room for everything: as much as is getting through now, shared out fairly.
      const getting = fresh.reduce((sum, s) => sum + s.sample!.sentBps, 0);
      if (getting > 0) this.total = Math.min(full, Math.max(MIN_LINK_BPS * all.length, getting * BACK_OFF));
      this.calmSince = this.now();
    } else if (this.total !== null && this.now() - this.calmSince >= CALM_MS) {
      this.total *= GROW;
      this.calmSince = this.now();
      if (this.total >= full) this.total = null;
    }
  }

  /** How a link should send now. */
  planFor(link: object): SendPlan {
    const state = this.links.get(link);
    if (!state) return { maxBitrateBps: this.options.playerBps, scaleResolutionDownBy: 1, maxFramerate: undefined };
    const all = [...this.links.values()];
    const own = this.limitOf(state);
    const weights = all.reduce((sum, s) => sum + this.limitOf(s), 0);
    const share = this.total === null ? own : Math.max(MIN_LINK_BPS, (this.total * own) / weights);
    const scale = SCALES[state.step]! * (state.watcher ? WATCHER_SCALE : 1);
    return {
      maxBitrateBps: Math.round(Math.min(own, share)),
      scaleResolutionDownBy: scale,
      maxFramerate: state.watcher ? WATCHER_FPS : undefined,
    };
  }

  private limitOf(state: LinkState): number {
    return state.watcher ? this.options.watcherBps : this.options.playerBps;
  }
}
