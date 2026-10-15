import { MAX_SEATS, type SeatIndex } from './table';
import { PHASES, isPhase, type Phase } from './turns';

/**
 * Something the table has to deal with before the game moves on: a player asked everyone to wait, a trigger
 * reminder came up, or the active player reached a phase someone asked to stop at. It stays until someone says it's
 * resolved.
 */
export interface Call {
  /** Made up by the player who called, or (for a reminder or stop) the reminder's id and the turn. */
  readonly id: string;
  readonly kind: 'wait' | 'reminder' | 'stop';
  /** Who called, or set the reminder or stop. */
  readonly seat: SeatIndex;
  /** A reminder's text. Empty for a wait or a stop without one. */
  readonly text: string;
  /** Where the turn was, and whose it was. Null before the first turn. */
  readonly phase: Phase | null;
  readonly activeSeat: SeatIndex | null;
  readonly turn: number;
}

/**
 * A reminder on a phase: "Ben's upkeep: Rhystic Study tax?". When the game gets to that phase on a turn it's for, it
 * comes up as a call. A stop is a reminder too: one that halts the active player at its phase, for one turn.
 */
export interface Reminder {
  /** Made up by the player who set it. */
  readonly id: string;
  /** Who set it. */
  readonly seat: SeatIndex;
  readonly phase: Phase;
  /** On whose turns. None: every turn. */
  readonly turns: readonly SeatIndex[];
  /** Only on this turn (a count of turns, like GameState.turn), or on every turn it's for. */
  readonly turn: number | null;
  readonly text: string;
  /** Gone once it has come up; otherwise it comes up every time, until it's taken away. */
  readonly once: boolean;
  /** The active player stops at the phase: moving past it, or passing the turn, ends there instead. */
  readonly stop: boolean;
}

/** A reminder in the game: what was set, and the last turn it came up on. */
export interface ReminderState extends Reminder {
  readonly lastTurn: number | null;
}

export const MAX_REMINDERS = 30;
export const MAX_CALLS = 20;
export const MAX_REMINDER_TEXT_LENGTH = 120;

/** Whether the reminder is for this turn: whose it is, and (for a one-turn reminder) which. */
export function reminderApplies(reminder: Reminder, activeSeat: SeatIndex, turn: number): boolean {
  return (
    (reminder.turns.length === 0 || reminder.turns.includes(activeSeat)) &&
    (reminder.turn === null || reminder.turn === turn)
  );
}

/** The phases passed through going from `from` (not counting it) to `to`, in order. None going back. */
export function phasesBetween(from: Phase | null, to: Phase | null): Phase[] {
  const start = from === null ? 0 : PHASES.indexOf(from) + 1;
  const end = to === null ? PHASES.length : PHASES.indexOf(to) + 1;
  return PHASES.slice(start, Math.max(start, end));
}

/** The id of the call a reminder makes when it comes up on a turn. */
export function reminderCallId(reminder: Reminder, turn: number): string {
  return `${reminder.id}@${turn}`;
}

/** Reads untrusted data as a reminder. Null if it isn't a valid one. */
export function toReminder(raw: unknown): Reminder | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { id, seat, phase, turns, turn, text, once, stop } = raw as Record<string, unknown>;
  const valid =
    isCallId(id) &&
    isSeat(seat) &&
    isPhase(phase) &&
    Array.isArray(turns) &&
    turns.length <= MAX_SEATS &&
    turns.every(isSeat) &&
    new Set(turns).size === turns.length &&
    (turn === null || (typeof turn === 'number' && Number.isInteger(turn) && turn >= 0)) &&
    typeof text === 'string' &&
    text.length <= MAX_REMINDER_TEXT_LENGTH &&
    typeof once === 'boolean' &&
    typeof stop === 'boolean';
  if (!valid) return null;
  return {
    id,
    seat,
    phase,
    turns: [...(turns as SeatIndex[])],
    turn: turn as number | null,
    text: text.trim(),
    once,
    stop,
  };
}

/** The id a player gives a call or a reminder. */
export function isCallId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

function isSeat(value: unknown): value is SeatIndex {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < MAX_SEATS;
}
