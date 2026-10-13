import { MAX_SEATS, type SeatIndex } from './table';

export const STARTING_LIFE = 40;
/** No single life change is bigger than this. Guards against typos and garbage input. */
export const MAX_LIFE_CHANGE = 1000;
export const MAX_STARTING_LIFE = 999;

export interface SeatGameState {
  readonly life: number;
}

/** Everything about the game in progress. Kept per seat, so it survives a player reconnecting. */
export interface GameState {
  /** Counts the games played at this table, starting at 1. */
  readonly number: number;
  readonly seats: readonly SeatGameState[];
}

/**
 * Something that happened in the game. The game state is the result of applying every event in order.
 * Changes are relative ("lose 3"), not absolute ("set to 37"), so two players changing the same total
 * at the same time both count.
 */
export type GameEvent =
  | { readonly type: 'life-changed'; readonly seat: SeatIndex; readonly amount: number }
  | { readonly type: 'new-game'; readonly startingLife: number };

export function newGame(startingLife = STARTING_LIFE, number = 1): GameState {
  return { number, seats: Array.from({ length: MAX_SEATS }, () => ({ life: startingLife })) };
}

export function applyEvent(state: GameState, event: GameEvent): GameState {
  switch (event.type) {
    case 'life-changed':
      return {
        ...state,
        seats: state.seats.map((seat, index) =>
          index === event.seat ? { ...seat, life: seat.life + event.amount } : seat,
        ),
      };
    case 'new-game':
      return newGame(event.startingLife, state.number + 1);
  }
}

export function applyEvents(state: GameState, events: Iterable<GameEvent>): GameState {
  let current = state;
  for (const event of events) current = applyEvent(current, event);
  return current;
}

/** Reads untrusted data (from the network) as a game event. Returns null if it isn't a valid one. */
export function toGameEvent(raw: unknown): GameEvent | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  switch (value.type) {
    case 'life-changed':
      return isSeat(value.seat) && isWholeNumber(value.amount) && value.amount !== 0 && Math.abs(value.amount) <= MAX_LIFE_CHANGE
        ? { type: 'life-changed', seat: value.seat, amount: value.amount }
        : null;
    case 'new-game':
      return isWholeNumber(value.startingLife) && value.startingLife > 0 && value.startingLife <= MAX_STARTING_LIFE
        ? { type: 'new-game', startingLife: value.startingLife }
        : null;
    default:
      return null;
  }
}

function isSeat(value: unknown): value is SeatIndex {
  return isWholeNumber(value) && value >= 0 && value < MAX_SEATS;
}

function isWholeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}
