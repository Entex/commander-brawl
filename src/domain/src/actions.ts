import { isAnnouncement, isSeatIndex, isSeatList, toGameEvent, type GameEvent } from './game';
import type { SeatIndex } from './table';
import { rollPlanarDie, toSchemeDeck, toVariantDeck, type Scheme, type VariantCard } from './variants';

export const MAX_DIE_SIDES = 1000;
/** Dice or coins at once. */
export const MAX_ROLLS = 10;

/**
 * A request that needs chance, like shuffling the turn order or rolling a die. Players send these to the
 * host, and the host rolls the dice and records the result as an ordinary event. Nobody can re-roll until
 * they like it, and nobody can send a result of their own (see toGameAction).
 */
export type GameIntent =
  | { readonly type: 'randomize-turn-order'; readonly seats: readonly SeatIndex[] }
  | { readonly type: 'roll-dice'; readonly sides: number; readonly count: number }
  | { readonly type: 'flip-coins'; readonly count: number }
  /** A random player from these seats: a random opponent, or anyone. */
  | { readonly type: 'pick-seat'; readonly seats: readonly SeatIndex[] }
  /** Planechase with these planes (and phenomena), shuffled. */
  | { readonly type: 'start-planechase'; readonly deck: readonly VariantCard[] }
  | { readonly type: 'roll-planar-die' }
  /** Archenemy with this player as the archenemy and these schemes, shuffled. */
  | { readonly type: 'start-archenemy'; readonly seat: SeatIndex; readonly deck: readonly Scheme[] };

/** What a player can ask for: an event, or an intent the host turns into one. */
export type GameAction = GameEvent | GameIntent;

const INTENTS: ReadonlySet<string> = new Set([
  'randomize-turn-order',
  'roll-dice',
  'flip-coins',
  'pick-seat',
  'start-planechase',
  'roll-planar-die',
  'start-archenemy',
]);

export function isIntent(action: GameAction): action is GameIntent {
  return INTENTS.has(action.type);
}

/** Events that only the host makes, from an intent: the results of chance. */
export function isChanceResult(event: GameEvent): boolean {
  return (
    event.type === 'turn-order-set' ||
    event.type === 'dice-rolled' ||
    event.type === 'coins-flipped' ||
    event.type === 'seat-picked' ||
    event.type === 'planechase-started' ||
    event.type === 'planar-die-rolled' ||
    event.type === 'archenemy-started'
  );
}

/**
 * Whether a player can take this back. Not an undo itself, not an announcement (nothing changed), and not a
 * result of chance: taking it back and asking again would be rolling until you like it.
 */
export function isUndoable(event: GameEvent): boolean {
  return event.type !== 'undo' && !isAnnouncement(event) && !isChanceResult(event);
}

/**
 * Reads untrusted data from a player as an action. Returns null if it isn't a valid one, and for results of
 * chance: a player asks for a roll, and the host rolls.
 */
export function toGameAction(raw: unknown): GameAction | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  switch (value.type) {
    case 'randomize-turn-order':
      return isSeatList(value.seats) ? { type: 'randomize-turn-order', seats: value.seats } : null;
    case 'roll-dice':
      return isCount(value.count, MAX_ROLLS) && isCount(value.sides, MAX_DIE_SIDES) && value.sides >= 2
        ? { type: 'roll-dice', sides: value.sides, count: value.count }
        : null;
    case 'flip-coins':
      return isCount(value.count, MAX_ROLLS) ? { type: 'flip-coins', count: value.count } : null;
    case 'pick-seat':
      return isSeatList(value.seats) ? { type: 'pick-seat', seats: value.seats } : null;
    case 'start-planechase': {
      const deck = toVariantDeck(value.deck);
      return deck ? { type: 'start-planechase', deck } : null;
    }
    case 'roll-planar-die':
      return { type: 'roll-planar-die' };
    case 'start-archenemy': {
      const deck = toSchemeDeck(value.deck);
      return deck && isSeatIndex(value.seat) ? { type: 'start-archenemy', seat: value.seat, deck } : null;
    }
    default: {
      const event = toGameEvent(raw);
      return event && !isChanceResult(event) ? event : null;
    }
  }
}

/** Turns an action into the event to record. `random` returns a number in [0, 1). */
export function resolveAction(action: GameAction, random: () => number): GameEvent {
  if (!isIntent(action)) return action;
  switch (action.type) {
    case 'randomize-turn-order':
      return { type: 'turn-order-set', order: shuffle(action.seats, random) };
    case 'roll-dice':
      return {
        type: 'dice-rolled',
        sides: action.sides,
        results: Array.from({ length: action.count }, () => 1 + Math.floor(random() * action.sides)),
      };
    case 'flip-coins':
      return {
        type: 'coins-flipped',
        results: Array.from({ length: action.count }, () => (random() < 0.5 ? 'heads' : 'tails')),
      };
    case 'pick-seat':
      return {
        type: 'seat-picked',
        seats: action.seats,
        picked: action.seats[Math.floor(random() * action.seats.length)]!,
      };
    case 'start-planechase':
      return { type: 'planechase-started', deck: shuffle(action.deck, random) };
    case 'roll-planar-die':
      return { type: 'planar-die-rolled', result: rollPlanarDie(random) };
    case 'start-archenemy':
      return { type: 'archenemy-started', seat: action.seat, deck: shuffle(action.deck, random) };
  }
}

function isCount(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= max;
}

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}
