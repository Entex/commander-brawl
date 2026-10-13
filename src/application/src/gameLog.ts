import {
  applyEvent,
  applyEvents,
  isIntent,
  isUndoable,
  newGame,
  resolveAction,
  toGameAction,
  type GameAction,
  type GameEvent,
  type GameState,
  type Player,
} from '@commander-brawl/domain';
import type { Unsubscribe } from './ports';

/** An event as recorded by the host: where it is in the log, who did it, and when. */
export interface LoggedEvent {
  /** Position in the log, starting at 0. The same for every player. */
  readonly seq: number;
  /** Chosen by the player who made the change, so a resend after a dropped connection isn't applied twice. */
  readonly id: string;
  /** Host time, in milliseconds since 1970. */
  readonly at: number;
  readonly by: Player;
  readonly event: GameEvent;
}

/** A run of log entries from the host, starting at position `from`. */
export interface LogBatch {
  /** Identifies the log. A different id means a different table, so start over. */
  readonly logId: string;
  readonly from: number;
  readonly events: readonly LoggedEvent[];
  /** Sent the moment it happened, rather than as catch-up after joining or reconnecting. */
  readonly live?: boolean;
}

interface Recorded {
  readonly id: string;
  readonly event: GameEvent;
}

/** Ids of the events that were taken back. */
export function undoneIds(entries: Iterable<Recorded>): Set<string> {
  const undone = new Set<string>();
  for (const entry of entries) if (entry.event.type === 'undo') undone.add(entry.event.target);
  return undone;
}

/**
 * The game as if the events that were taken back never happened. Entries not yet in the log (no time of
 * their own) count as happening at `now` (the host's clock).
 */
export function replayLog(entries: Iterable<Recorded & { readonly at?: number }>, now = 0): GameState {
  const all = [...entries];
  const undone = undoneIds(all);
  let state = newGame();
  for (const entry of all) {
    if (entry.event.type !== 'undo' && !undone.has(entry.id)) state = applyEvent(state, entry.event, entry.at ?? now);
  }
  return state;
}

/** Keeps a game session to roughly a few hours of play. Past this, the host stops taking new events. */
export const MAX_LOG_LENGTH = 100_000;

export type AppendResult =
  { readonly ok: true; readonly entry: LoggedEvent } | { readonly ok: false; readonly reason: 'duplicate' | 'refused' };

/** The host's copy of the log. It decides the order everyone applies events in. */
export class HostGameLog {
  private readonly entries: LoggedEvent[] = [];
  private readonly byId = new Map<string, LoggedEvent>();
  private readonly undone = new Set<string>();

  constructor(
    readonly logId: string,
    private readonly now: () => number,
    /** Returns a number in [0, 1). The host rolls the dice for everyone. */
    private readonly random: () => number = Math.random,
  ) {}

  get length(): number {
    return this.entries.length;
  }

  /**
   * Continues a saved log, e.g. after the host's app restarted. It gets a new log id, so every player
   * replaces their copy with the host's: the saved log is the truth, even if it lost the last few changes.
   */
  static restore(
    logId: string,
    entries: readonly LoggedEvent[],
    now: () => number,
    random: () => number = Math.random,
  ): HostGameLog {
    const log = new HostGameLog(logId, now, random);
    for (const entry of entries) {
      if (entry.seq !== log.entries.length) break;
      log.entries.push(entry);
      log.byId.set(entry.id, entry);
      if (entry.event.type === 'undo') log.undone.add(entry.event.target);
    }
    return log;
  }

  /** Every entry, oldest first. */
  all(): readonly LoggedEvent[] {
    return [...this.entries];
  }

  /**
   * Adds a player's action. A duplicate is one already in the log (a resend after a dropped connection);
   * a refused one isn't valid or isn't allowed, and the player who sent it should drop it.
   */
  append(author: Player, id: string, raw: unknown): AppendResult {
    if (this.byId.has(id)) return { ok: false, reason: 'duplicate' };
    if (this.entries.length >= MAX_LOG_LENGTH) return { ok: false, reason: 'refused' };
    const action = toGameAction(raw);
    if (!action) return { ok: false, reason: 'refused' };
    const event = resolveAction(action, this.random);
    if (event.type === 'undo' && !this.canUndo(author, event.target)) return { ok: false, reason: 'refused' };
    const entry: LoggedEvent = { seq: this.entries.length, id, at: this.now(), by: { ...author }, event };
    this.entries.push(entry);
    this.byId.set(id, entry);
    if (event.type === 'undo') this.undone.add(event.target);
    return { ok: true, entry };
  }

  /**
   * Players can only take back their own changes, once. Fixing someone else's mistake is a new change. Some
   * things can't be taken back at all (see isUndoable): announcements, and results of chance.
   */
  private canUndo(author: Player, target: string): boolean {
    const entry = this.byId.get(target);
    return entry !== undefined && isUndoable(entry.event) && !this.undone.has(target) && entry.by.seat === author.seat;
  }

  /** Answers a player's request to catch up. A player with a different log (or none) gets all of it. */
  batchFor(logId: string | null, from: number): LogBatch {
    const start = logId === this.logId ? Math.max(0, Math.min(from, this.entries.length)) : 0;
    return { logId: this.logId, from: start, events: this.entries.slice(start) };
  }
}

export type GameSyncMessage =
  | { readonly kind: 'event'; readonly id: string; readonly event: GameAction }
  | { readonly kind: 'sync'; readonly logId: string | null; readonly from: number };

export interface GameSyncTransport {
  /** Sends to the host. Returns false if there's no connection right now. */
  send(message: GameSyncMessage): boolean;
}

export interface GameView {
  /** The game with your own changes already applied, even before the host confirms them. */
  readonly state: GameState;
  /** The newest log entries, oldest first. */
  readonly recent: readonly LoggedEvent[];
  readonly logLength: number;
  /** Your changes the host hasn't confirmed yet. More than zero for long means the connection is down. */
  readonly unconfirmed: number;
  /**
   * The newest event that arrived as it happened, not as catch-up. For reacting to things in the moment
   * (like a card someone shows), without replaying the past to a player who just joined.
   */
  readonly lastLive: LoggedEvent | null;
  /** The last few events that arrived as they happened, oldest first: lastLive and the ones before it. */
  readonly live: readonly LoggedEvent[];
  /**
   * The host's clock minus this computer's, in milliseconds, as best known (from when live events arrive). The
   * turn timer counts on the host's clock: add this to the time here to compare.
   */
  readonly hostClockOffset: number;
}

const RECENT_LIMIT = 30;
const LIVE_LIMIT = 10;

/**
 * A player's copy of the log. Your own changes show up at once and are sent to the host; they stay
 * queued until the host confirms them, so nothing is lost when the connection drops.
 */
export class GameSync {
  private logId: string | null = null;
  private readonly log: LoggedEvent[] = [];
  private confirmed: GameState = newGame();
  private pending: { readonly id: string; readonly event: GameAction }[] = [];
  private live: LoggedEvent[] = [];
  private readonly listeners = new Set<(view: GameView) => void>();
  private view: GameView;

  /** See GameView.hostClockOffset. */
  private hostClockOffset = 0;

  constructor(
    private readonly transport: GameSyncTransport,
    private readonly createId: () => string,
    /** This computer's clock, in milliseconds since 1970. */
    private readonly now: () => number = () => Date.now(),
  ) {
    this.view = this.buildView();
  }

  getView(): GameView {
    return this.view;
  }

  /** The whole confirmed log, oldest first. */
  getLog(): readonly LoggedEvent[] {
    return [...this.log];
  }

  subscribe(listener: (view: GameView) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  submit(event: GameAction): void {
    const entry = { id: this.createId(), event };
    this.pending.push(entry);
    this.transport.send({ kind: 'event', ...entry });
    this.publish();
  }

  /** The connection to the host is up (again): catch up, and resend whatever wasn't confirmed. */
  connected(): void {
    this.requestFrom(this.log.length);
    // The host ignores events it already has, so resending is always safe.
    for (const entry of this.pending) this.transport.send({ kind: 'event', ...entry });
  }

  received(batch: LogBatch): void {
    if (batch.logId !== this.logId) {
      if (batch.from !== 0) {
        // Part of a log we don't know. Ask for all of it.
        this.transport.send({ kind: 'sync', logId: null, from: 0 });
        return;
      }
      this.logId = batch.logId;
      this.log.length = 0;
      this.confirmed = newGame();
      this.live = [];
    }
    if (batch.from > this.log.length) {
      // Missed something in between. Ask for the gap.
      this.requestFrom(this.log.length);
      return;
    }

    let changed = false;
    let undo = false;
    for (const entry of batch.events.slice(this.log.length - batch.from)) {
      if (entry.seq !== this.log.length) {
        this.requestFrom(this.log.length);
        break;
      }
      this.log.push(entry);
      if (batch.live) {
        this.live = [...this.live.slice(1 - LIVE_LIMIT), entry];
        // It just happened, so the host's clock said `at` about now (give or take the trip here).
        this.hostClockOffset = entry.at - this.now();
      }
      if (entry.event.type === 'undo') undo = true;
      else this.confirmed = applyEvent(this.confirmed, entry.event, entry.at);
      this.pending = this.pending.filter((p) => p.id !== entry.id);
      changed = true;
    }
    // Taking something back changes what came after it, so work the game out again from the start.
    if (undo) this.confirmed = replayLog(this.log);
    if (changed) this.publish();
  }

  /** The host turned one of our actions down. Drop it, so the preview stops showing it. */
  refused(id: string): void {
    const before = this.pending.length;
    this.pending = this.pending.filter((p) => p.id !== id);
    if (this.pending.length !== before) this.publish();
  }

  private requestFrom(from: number): void {
    this.transport.send({ kind: 'sync', logId: this.logId, from });
  }

  private publish(): void {
    this.view = this.buildView();
    for (const listener of this.listeners) listener(this.view);
  }

  private buildView(): GameView {
    // Actions that need the host (like a shuffle) only show up once the host has decided them.
    const pending = this.pending.flatMap((p) => (isIntent(p.event) ? [] : [{ id: p.id, event: p.event }]));
    // Your own changes the host hasn't confirmed yet count as happening now.
    const hostNow = this.now() + this.hostClockOffset;
    const state = pending.some((p) => p.event.type === 'undo')
      ? replayLog([...this.log, ...pending], hostNow)
      : applyEvents(
          this.confirmed,
          pending.map((p) => p.event),
          hostNow,
        );
    return {
      state,
      recent: this.log.slice(-RECENT_LIMIT),
      logLength: this.log.length,
      unconfirmed: this.pending.length,
      lastLive: this.live.at(-1) ?? null,
      live: this.live,
      hostClockOffset: this.hostClockOffset,
    };
  }
}
