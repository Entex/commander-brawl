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
  /** The picture's longer side, at most, in pixels: 1920 for 1080p. A bigger camera picture is made smaller. */
  readonly maxLongSide: number;
  readonly maxFramerate: number | undefined;
}

/** How sharp the video sent to the others is, as the height of a 16:9 picture. */
export type SentHeight = 480 | 720 | 1080;
export const SENT_HEIGHTS: readonly SentHeight[] = [480, 720, 1080];

/** Each sent quality's picture (its longer side) and its share of the bitrate 1080p gets. */
const SENT: Record<SentHeight, { readonly longSide: number; readonly share: number }> = {
  480: { longSide: 854, share: 0.35 },
  720: { longSide: 1280, share: 0.6 },
  1080: { longSide: 1920, share: 1 },
};

export interface UploadBudgetOptions {
  /** The most one player gets, at 1080p. */
  readonly playerBps: number;
  /** The most one watcher gets: they don't need video sharp enough for close-ups. */
  readonly watcherBps: number;
  readonly now?: () => number;
}

/** A watcher's picture is at most this big (its longer side: 720p), at most this many frames a second. */
const WATCHER_LONG_SIDE = 1280;
const WATCHER_FPS = 20;
/** Never less than this for a link, however tight it gets: a picture at all. */
const MIN_LINK_BPS = 300_000;
/** When the upload is full, the budget is this share of what's getting through. */
const BACK_OFF = 0.9;
/** Cut at most this often: each cut has to show in what's getting through before the next is worth it. */
const CUT_EVERY_MS = 10_000;
/** A stream sending this share of the most it may is held back by that, not by the network. */
const AT_CAP = 0.9;
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
  private cutAt = Number.NEGATIVE_INFINITY;
  private readonly now: () => number;
  /** How sharp the player chose to send. */
  private sent: SentHeight = 1080;

  constructor(private readonly options: UploadBudgetOptions) {
    this.now = options.now ?? (() => Date.now());
    this.calmSince = this.now();
  }

  /** How sharp the video sent is to be: the picture's size, and the bitrate that goes with it. */
  setSentHeight(height: SentHeight): void {
    if (height === this.sent) return;
    this.sent = height;
    // A fresh start: what didn't fit at one size says little about another.
    this.total = null;
  }

  get sentHeight(): SentHeight {
    return this.sent;
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

    const now = this.now();
    const all = [...this.links.values()];
    const full = all.reduce((sum, s) => sum + this.limitOf(s), 0);
    // What links reported lately: one that stopped sending (no camera) doesn't count.
    const fresh = all.filter((s) => s.sample !== null && now - s.at <= FRESH_MS);
    // Held back by the network: not a stream at the most it may send, which WebRTC says is "bandwidth" too.
    const squeezed = fresh.filter(
      (s) => s.sample!.limitation === 'bandwidth' && s.sample!.sentBps < this.bitrateOf(s) * AT_CAP,
    );
    // The upload is full when most streams are held back at once. One alone is that one's connection (a watcher on
    // poor Wi-Fi, say): WebRTC slows that stream by itself, and the others needn't go slower for it.
    if (squeezed.length >= 2 && squeezed.length * 2 >= fresh.length) {
      if (now - this.cutAt >= CUT_EVERY_MS) {
        // As much as is getting through now, shared out fairly.
        const getting = fresh.reduce((sum, s) => sum + s.sample!.sentBps, 0);
        if (getting > 0) this.total = Math.min(full, Math.max(MIN_LINK_BPS * all.length, getting * BACK_OFF));
        this.cutAt = now;
      }
      this.calmSince = now;
    } else if (this.total !== null && now - this.calmSince >= CALM_MS) {
      this.total *= GROW;
      this.calmSince = now;
      if (this.total >= full) this.total = null;
    }
  }

  /** How a link should send now. */
  planFor(link: object): SendPlan {
    const { longSide } = SENT[this.sent];
    const state = this.links.get(link);
    if (!state) return { maxBitrateBps: this.playerBps(), maxLongSide: longSide, maxFramerate: undefined };
    const side = state.watcher ? Math.min(longSide, WATCHER_LONG_SIDE) : longSide;
    return {
      maxBitrateBps: this.bitrateOf(state),
      maxLongSide: Math.round(side / SCALES[state.step]!),
      maxFramerate: state.watcher ? WATCHER_FPS : undefined,
    };
  }

  /** The most a link may send now: its own limit, or its share of the budget. */
  private bitrateOf(state: LinkState): number {
    const own = this.limitOf(state);
    if (this.total === null) return own;
    const weights = [...this.links.values()].reduce((sum, s) => sum + this.limitOf(s), 0);
    return Math.round(Math.min(own, Math.max(MIN_LINK_BPS, (this.total * own) / weights)));
  }

  private playerBps(): number {
    return Math.round(this.options.playerBps * SENT[this.sent].share);
  }

  private limitOf(state: LinkState): number {
    return state.watcher ? Math.min(this.options.watcherBps, this.playerBps()) : this.playerBps();
  }
}
