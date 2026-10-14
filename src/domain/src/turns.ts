import { MAX_SEATS, type SeatIndex } from './table';

/**
 * The steps of a turn the table follows, in order. Untap is left out: nobody does anything there. Combat
 * starts at its beginning, then attackers, blockers and damage.
 */
export const PHASES = ['upkeep', 'draw', 'main1', 'combat', 'attackers', 'blockers', 'damage', 'main2', 'end'] as const;
export type Phase = (typeof PHASES)[number];

/** The steps that are part of combat. */
export const COMBAT_STEPS: readonly Phase[] = ['combat', 'attackers', 'blockers', 'damage'];

export function isPhase(value: unknown): value is Phase {
  return typeof value === 'string' && (PHASES as readonly string[]).includes(value);
}

/** The phase after this one, through each step of combat. Null at the end: what comes next is passing the turn. */
export function nextPhase(phase: Phase): Phase | null {
  return PHASES[PHASES.indexOf(phase) + 1] ?? null;
}

/**
 * A turn timer gives every turn the same time; a chess clock gives each player a time bank for the whole game.
 * Neither stops anyone: running out just shows.
 */
export type ClockKind = 'turn' | 'chess';

export interface ClockSettings {
  readonly kind: ClockKind;
  /** Per turn, or per player for the whole game. */
  readonly minutes: number;
}

export const MAX_CLOCK_MINUTES = 240;

export interface Clock {
  readonly settings: ClockSettings;
  /**
   * Time each seat has used, in milliseconds, not counting a stretch that's running now: this turn's for a
   * turn timer, the whole game's for a chess clock.
   */
  readonly used: readonly number[];
  /** Counting for this seat since this time (the host's clock, in milliseconds), or null while stopped. */
  readonly running: { readonly seat: SeatIndex; readonly since: number } | null;
  /** Someone stopped it, for a response or a break. The next phase or turn starts it again. */
  readonly paused: boolean;
}

/** A fresh clock, running for the active seat if a turn is on. */
export function newClock(settings: ClockSettings, activeSeat: SeatIndex | null, at: number): Clock {
  return {
    settings,
    used: Array.from({ length: MAX_SEATS }, () => 0),
    running: activeSeat === null ? null : { seat: activeSeat, since: at },
    paused: false,
  };
}

/** Stops the clock, adding the time since it started to that seat. */
export function stopClock(clock: Clock, at: number): Clock {
  const { running } = clock;
  if (!running) return clock;
  const used = clock.used.map((ms, seat) => (seat === running.seat ? ms + Math.max(0, at - running.since) : ms));
  return { ...clock, used, running: null };
}

export function pauseClock(clock: Clock, at: number): Clock {
  return clock.running ? { ...stopClock(clock, at), paused: true } : clock;
}

/** Runs the clock for this seat from now on (and no longer for whoever had it). */
export function runClock(clock: Clock, seat: SeatIndex, at: number): Clock {
  return { ...stopClock(clock, at), running: { seat, since: at }, paused: false };
}

/** A new turn: a turn timer starts over for the player whose turn it is. */
export function clockForTurn(clock: Clock, seat: SeatIndex, at: number): Clock {
  const stopped = stopClock(clock, at);
  const used = clock.settings.kind === 'turn' ? stopped.used.map((ms, s) => (s === seat ? 0 : ms)) : stopped.used;
  return { ...stopped, used, running: { seat, since: at }, paused: false };
}

/** How much time this seat has left at `now` (the host's clock), in milliseconds. Below zero when over. */
export function timeLeft(clock: Clock, seat: SeatIndex, now: number): number {
  const running = clock.running?.seat === seat ? Math.max(0, now - clock.running.since) : 0;
  return clock.settings.minutes * 60_000 - (clock.used[seat] ?? 0) - running;
}

/** Reads untrusted data as clock settings. Null if they aren't valid ones. */
export function toClockSettings(raw: unknown): ClockSettings | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { kind, minutes } = raw as Record<string, unknown>;
  if (kind !== 'turn' && kind !== 'chess') return null;
  if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < 1 || minutes > MAX_CLOCK_MINUTES) {
    return null;
  }
  return { kind, minutes };
}
