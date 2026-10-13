import {
  applyEvent,
  applyEvents,
  newGame,
  toGameEvent,
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
}

/** Keeps a game session to roughly a few hours of play. Past this, the host stops taking new events. */
export const MAX_LOG_LENGTH = 100_000;

/** The host's copy of the log. It decides the order everyone applies events in. */
export class HostGameLog {
  private readonly entries: LoggedEvent[] = [];
  private readonly seen = new Set<string>();

  constructor(
    readonly logId: string,
    private readonly now: () => number,
  ) {}

  get length(): number {
    return this.entries.length;
  }

  /** Adds a player's event. Returns null for a duplicate or invalid event. */
  append(author: Player, id: string, raw: unknown): LoggedEvent | null {
    if (this.seen.has(id) || this.entries.length >= MAX_LOG_LENGTH) return null;
    const event = toGameEvent(raw);
    if (!event) return null;
    const entry: LoggedEvent = { seq: this.entries.length, id, at: this.now(), by: { ...author }, event };
    this.entries.push(entry);
    this.seen.add(id);
    return entry;
  }

  /** Answers a player's request to catch up. A player with a different log (or none) gets all of it. */
  batchFor(logId: string | null, from: number): LogBatch {
    const start = logId === this.logId ? Math.max(0, Math.min(from, this.entries.length)) : 0;
    return { logId: this.logId, from: start, events: this.entries.slice(start) };
  }
}

export type GameSyncMessage =
  | { readonly kind: 'event'; readonly id: string; readonly event: GameEvent }
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
}

const RECENT_LIMIT = 30;

/**
 * A player's copy of the log. Your own changes show up at once and are sent to the host; they stay
 * queued until the host confirms them, so nothing is lost when the connection drops.
 */
export class GameSync {
  private logId: string | null = null;
  private readonly log: LoggedEvent[] = [];
  private confirmed: GameState = newGame();
  private pending: { readonly id: string; readonly event: GameEvent }[] = [];
  private readonly listeners = new Set<(view: GameView) => void>();
  private view: GameView;

  constructor(
    private readonly transport: GameSyncTransport,
    private readonly createId: () => string,
  ) {
    this.view = this.buildView();
  }

  getView(): GameView {
    return this.view;
  }

  subscribe(listener: (view: GameView) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  submit(event: GameEvent): void {
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
    }
    if (batch.from > this.log.length) {
      // Missed something in between. Ask for the gap.
      this.requestFrom(this.log.length);
      return;
    }

    let changed = false;
    for (const entry of batch.events.slice(this.log.length - batch.from)) {
      if (entry.seq !== this.log.length) {
        this.requestFrom(this.log.length);
        break;
      }
      this.log.push(entry);
      this.confirmed = applyEvent(this.confirmed, entry.event);
      this.pending = this.pending.filter((p) => p.id !== entry.id);
      changed = true;
    }
    if (changed) this.publish();
  }

  private requestFrom(from: number): void {
    this.transport.send({ kind: 'sync', logId: this.logId, from });
  }

  private publish(): void {
    this.view = this.buildView();
    for (const listener of this.listeners) listener(this.view);
  }

  private buildView(): GameView {
    return {
      state: applyEvents(
        this.confirmed,
        this.pending.map((p) => p.event),
      ),
      recent: this.log.slice(-RECENT_LIMIT),
      logLength: this.log.length,
      unconfirmed: this.pending.length,
    };
  }
}
