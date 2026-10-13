import { isSeatList, toGameEvent, type GameEvent } from './game';
import type { SeatIndex } from './table';

/**
 * A request that needs chance, like shuffling the turn order. Players send these to the host, and the
 * host rolls the dice and records the result as an ordinary event. Nobody can re-roll until they like it.
 */
export type GameIntent = { readonly type: 'randomize-turn-order'; readonly seats: readonly SeatIndex[] };

/** What a player can ask for: an event, or an intent the host turns into one. */
export type GameAction = GameEvent | GameIntent;

export function isIntent(action: GameAction): action is GameIntent {
  return action.type === 'randomize-turn-order';
}

/** Reads untrusted data as an action. Returns null if it isn't a valid one. */
export function toGameAction(raw: unknown): GameAction | null {
  if (typeof raw === 'object' && raw !== null && (raw as { type?: unknown }).type === 'randomize-turn-order') {
    const seats = (raw as { seats?: unknown }).seats;
    return isSeatList(seats) ? { type: 'randomize-turn-order', seats } : null;
  }
  return toGameEvent(raw);
}

/** Turns an action into the event to record. `random` returns a number in [0, 1). */
export function resolveAction(action: GameAction, random: () => number): GameEvent {
  if (!isIntent(action)) return action;
  return { type: 'turn-order-set', order: shuffle(action.seats, random) };
}

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}
