import { MAX_SEATS, type SeatIndex } from './table';

export const STARTING_LIFE = 40;
/** No single change is bigger than this. Guards against typos and garbage input. */
export const MAX_CHANGE = 1000;
export const MAX_STARTING_LIFE = 999;
/** 21 or more combat damage from a single commander and you lose. */
export const COMMANDER_DAMAGE_LIMIT = 21;
/** Partners and backgrounds give a player two commanders. */
export const MAX_COMMANDERS = 2;
export const MAX_COMMANDER_NAME_LENGTH = 40;

export type CommanderIndex = 0 | 1;

export interface SeatGameState {
  readonly life: number;
  /** One name per commander, two for partners or a background. An empty name means "not named yet". */
  readonly commanders: readonly string[];
  /** commanderDamage[seat][commander]: damage this player has taken from that player's commander. */
  readonly commanderDamage: readonly (readonly number[])[];
  /** Set by hand: true = out, false = still in despite a losing condition, null = decided by the rules. */
  readonly outOverride: boolean | null;
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
  | {
      readonly type: 'commander-damage';
      readonly from: SeatIndex;
      readonly commander: CommanderIndex;
      readonly to: SeatIndex;
      readonly amount: number;
    }
  | { readonly type: 'commanders-named'; readonly seat: SeatIndex; readonly names: readonly string[] }
  | { readonly type: 'out-set'; readonly seat: SeatIndex; readonly out: boolean | null }
  | { readonly type: 'new-game'; readonly startingLife: number };

export type LossReason =
  | { readonly kind: 'life' }
  | { readonly kind: 'commander-damage'; readonly from: SeatIndex; readonly commander: CommanderIndex };

export function newGame(startingLife = STARTING_LIFE, number = 1, previous?: GameState): GameState {
  return {
    number,
    seats: Array.from({ length: MAX_SEATS }, (_, index) => ({
      life: startingLife,
      // Players usually keep their deck for the next game, so the commanders stay.
      commanders: previous?.seats[index]?.commanders ?? [''],
      commanderDamage: Array.from({ length: MAX_SEATS }, () => Array.from({ length: MAX_COMMANDERS }, () => 0)),
      outOverride: null,
    })),
  };
}

export function applyEvent(state: GameState, event: GameEvent): GameState {
  switch (event.type) {
    case 'life-changed':
      return updateSeat(state, event.seat, (seat) => ({ ...seat, life: seat.life + event.amount }));
    case 'commander-damage':
      // Commander damage is also ordinary damage, so it comes off life too.
      return updateSeat(state, event.to, (seat) => ({
        ...seat,
        life: seat.life - event.amount,
        commanderDamage: seat.commanderDamage.map((fromSeat, index) =>
          index === event.from ? fromSeat.map((d, c) => (c === event.commander ? d + event.amount : d)) : fromSeat,
        ),
      }));
    case 'commanders-named':
      return updateSeat(state, event.seat, (seat) => ({ ...seat, commanders: event.names }));
    case 'out-set':
      return updateSeat(state, event.seat, (seat) => ({ ...seat, outOverride: event.out }));
    case 'new-game':
      return newGame(event.startingLife, state.number + 1, state);
  }
}

export function applyEvents(state: GameState, events: Iterable<GameEvent>): GameState {
  let current = state;
  for (const event of events) current = applyEvent(current, event);
  return current;
}

/** Why the rules say this player has lost, or null if they haven't. */
export function lossReason(seat: SeatGameState): LossReason | null {
  if (seat.life <= 0) return { kind: 'life' };
  for (let from = 0; from < seat.commanderDamage.length; from++) {
    const damage = seat.commanderDamage[from]!;
    for (let commander = 0; commander < damage.length; commander++) {
      if (damage[commander]! >= COMMANDER_DAMAGE_LIMIT) {
        return { kind: 'commander-damage', from: from as SeatIndex, commander: commander as CommanderIndex };
      }
    }
  }
  return null;
}

/** Out by the rules, unless a player said otherwise (e.g. a card that stops them from losing). */
export function isOut(seat: SeatGameState): boolean {
  return seat.outOverride ?? lossReason(seat) !== null;
}

/** Reads untrusted data (from the network) as a game event. Returns null if it isn't a valid one. */
export function toGameEvent(raw: unknown): GameEvent | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  switch (value.type) {
    case 'life-changed':
      return isSeat(value.seat) && isChange(value.amount)
        ? { type: 'life-changed', seat: value.seat, amount: value.amount }
        : null;
    case 'commander-damage':
      return isSeat(value.from) && isCommander(value.commander) && isSeat(value.to) && isChange(value.amount)
        ? { type: 'commander-damage', from: value.from, commander: value.commander, to: value.to, amount: value.amount }
        : null;
    case 'commanders-named': {
      if (!isSeat(value.seat) || !Array.isArray(value.names)) return null;
      const names = value.names;
      const valid =
        names.length >= 1 &&
        names.length <= MAX_COMMANDERS &&
        names.every((n) => typeof n === 'string' && n.trim().length <= MAX_COMMANDER_NAME_LENGTH);
      return valid ? { type: 'commanders-named', seat: value.seat, names: names.map((n: string) => n.trim()) } : null;
    }
    case 'out-set':
      return isSeat(value.seat) && (value.out === null || typeof value.out === 'boolean')
        ? { type: 'out-set', seat: value.seat, out: value.out }
        : null;
    case 'new-game':
      return isWholeNumber(value.startingLife) && value.startingLife > 0 && value.startingLife <= MAX_STARTING_LIFE
        ? { type: 'new-game', startingLife: value.startingLife }
        : null;
    default:
      return null;
  }
}

function updateSeat(state: GameState, seat: SeatIndex, update: (seat: SeatGameState) => SeatGameState): GameState {
  return { ...state, seats: state.seats.map((s, index) => (index === seat ? update(s) : s)) };
}

function isSeat(value: unknown): value is SeatIndex {
  return isWholeNumber(value) && value >= 0 && value < MAX_SEATS;
}

function isCommander(value: unknown): value is CommanderIndex {
  return isWholeNumber(value) && value >= 0 && value < MAX_COMMANDERS;
}

function isChange(value: unknown): value is number {
  return isWholeNumber(value) && value !== 0 && Math.abs(value) <= MAX_CHANGE;
}

function isWholeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}
