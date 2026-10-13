import {
  MAX_CUSTOM_COUNTERS,
  clampToCounter,
  counterValue,
  hasReachedLoss,
  toCustomCounter,
  type CustomCounter,
} from './customCounters';
import { isBracket, toDeckAnalysis, type Bracket, type DeckAnalysis } from './brackets';
import { MAX_COMMANDERS, toDeckList, type DeckList } from './decks';
import { MAX_SEATS, type SeatIndex } from './table';

export const STARTING_LIFE = 40;
/** No single change is bigger than this. Guards against typos and garbage input. */
export const MAX_CHANGE = 1000;
export const MAX_STARTING_LIFE = 999;
/** 21 or more combat damage from a single commander and you lose. */
export const COMMANDER_DAMAGE_LIMIT = 21;
export const MAX_COMMANDER_NAME_LENGTH = 40;
/** 10 poison counters and you lose. */
export const POISON_LIMIT = 10;
/** Speed ("Start your engines!") never goes above 4. */
export const MAX_SPEED = 4;
/** Each earlier cast from the command zone adds this much to the cost. */
export const COMMANDER_TAX_PER_CAST = 2;

export type CommanderIndex = 0 | 1;

export const PLAYER_COUNTERS = ['poison', 'energy', 'experience', 'rad', 'speed'] as const;
export type PlayerCounter = (typeof PLAYER_COUNTERS)[number];

export interface SeatGameState {
  readonly life: number;
  /** One name per commander, two for partners or a background. An empty name means "not named yet". */
  readonly commanders: readonly string[];
  /** commanderDamage[seat][commander]: damage this player has taken from that player's commander. */
  readonly commanderDamage: readonly (readonly number[])[];
  /** Set by hand: true = out, false = still in despite a losing condition, null = decided by the rules. */
  readonly outOverride: boolean | null;
  readonly counters: Readonly<Record<PlayerCounter, number>>;
  /** How many times each commander has been cast this game. */
  readonly commanderCasts: readonly number[];
  /** Values of the table's per-player custom counters, by counter id. Missing means the counter's start value. */
  readonly custom: Readonly<Record<string, number>>;
  /** The deck this player is playing, if they chose one. */
  readonly deck: DeckList | null;
  /** What's in that deck that matters for brackets, once it's been checked. */
  readonly deckAnalysis: DeckAnalysis | null;
  /** How strong the player says their deck is. */
  readonly bracket: Bracket | null;
}

/** Everything about the game in progress. Kept per seat, so it survives a player reconnecting. */
export interface GameState {
  /** Counts the games played at this table, starting at 1. */
  readonly number: number;
  readonly seats: readonly SeatGameState[];
  /** Counters the players made up. They stay for the next game; their values start over. */
  readonly customCounters: readonly CustomCounter[];
  /** Values of the table-wide custom counters, by counter id. */
  readonly tableCounters: Readonly<Record<string, number>>;
  /** Seats in the order they take turns, or null before it's decided. */
  readonly turnOrder: readonly SeatIndex[] | null;
  readonly activeSeat: SeatIndex | null;
  /** Turns taken so far this game, counting the current one. 0 before the first turn. */
  readonly turn: number;
  /** Times around the table, counting the current one. */
  readonly round: number;
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
  | {
      readonly type: 'counter-changed';
      readonly seat: SeatIndex;
      readonly counter: PlayerCounter;
      readonly amount: number;
    }
  | {
      readonly type: 'commander-cast';
      readonly seat: SeatIndex;
      readonly commander: CommanderIndex;
      readonly amount: number;
    }
  /** Adds a custom counter, or replaces the one with the same id. */
  | { readonly type: 'custom-counter-saved'; readonly counter: CustomCounter }
  | { readonly type: 'custom-counter-removed'; readonly id: string }
  /** Changes a custom counter, for one player or (seat null) the whole table. */
  | {
      readonly type: 'custom-counter-changed';
      readonly id: string;
      readonly seat: SeatIndex | null;
      readonly amount: number;
    }
  /** The player picked the deck they're playing (null: none). Its commanders become the seat's commanders. */
  | { readonly type: 'deck-chosen'; readonly seat: SeatIndex; readonly deck: DeckList | null }
  /**
   * A player put a card in the spotlight for everyone to see, because they cast it or just to show it.
   * It doesn't change the game; it's there so every player sees the card, and it lands in the log.
   */
  | {
      readonly type: 'card-shown';
      readonly card: { readonly id: string; readonly name: string };
      readonly reason: 'cast' | 'show';
    }
  /**
   * "Wait, I have a response!": the player wants to respond before the game moves on. Flashes on every
   * screen; like a card shown, it doesn't change the game.
   */
  | { readonly type: 'response-called' }
  /** The checks on a deck are in. Only counts while that deck is still the one being played. */
  | {
      readonly type: 'deck-analyzed';
      readonly seat: SeatIndex;
      readonly deckName: string;
      readonly analysis: DeckAnalysis;
    }
  | { readonly type: 'bracket-declared'; readonly seat: SeatIndex; readonly bracket: Bracket | null }
  /** Sets the turn order and starts the first turn. */
  | { readonly type: 'turn-order-set'; readonly order: readonly SeatIndex[] }
  /** Only counts if `from` still has the turn, so a double click can't skip a player. */
  | { readonly type: 'turn-passed'; readonly from: SeatIndex }
  | { readonly type: 'new-game'; readonly startingLife: number }
  /**
   * Takes back an earlier event, by its id in the game log. The state is then worked out as if that
   * event never happened, so this is handled where the whole log is known (see replayLog), not here.
   */
  | { readonly type: 'undo'; readonly target: string };

export type LossReason =
  | { readonly kind: 'life' }
  | { readonly kind: 'poison' }
  | { readonly kind: 'commander-damage'; readonly from: SeatIndex; readonly commander: CommanderIndex }
  | { readonly kind: 'custom-counter'; readonly counter: CustomCounter };

export function newGame(startingLife = STARTING_LIFE, number = 1, previous?: GameState): GameState {
  return {
    number,
    seats: Array.from({ length: MAX_SEATS }, (_, index) => ({
      life: startingLife,
      // Players usually keep their deck for the next game, so the commanders stay.
      commanders: previous?.seats[index]?.commanders ?? [''],
      commanderDamage: Array.from({ length: MAX_SEATS }, () => Array.from({ length: MAX_COMMANDERS }, () => 0)),
      outOverride: null,
      counters: { poison: 0, energy: 0, experience: 0, rad: 0, speed: 0 },
      commanderCasts: Array.from({ length: MAX_COMMANDERS }, () => 0),
      custom: {},
      // Like the commanders, the deck (and what the player says about it) usually stays for the next game.
      deck: previous?.seats[index]?.deck ?? null,
      deckAnalysis: previous?.seats[index]?.deckAnalysis ?? null,
      bracket: previous?.seats[index]?.bracket ?? null,
    })),
    customCounters: previous?.customCounters ?? [],
    tableCounters: {},
    turnOrder: null,
    activeSeat: null,
    turn: 0,
    round: 0,
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
    case 'counter-changed':
      return updateSeat(state, event.seat, (seat) => ({
        ...seat,
        counters: {
          ...seat.counters,
          [event.counter]: clamp(seat.counters[event.counter] + event.amount, 0, counterMaximum(event.counter)),
        },
      }));
    case 'commander-cast':
      return updateSeat(state, event.seat, (seat) => ({
        ...seat,
        commanderCasts: seat.commanderCasts.map((casts, c) =>
          c === event.commander ? Math.max(0, casts + event.amount) : casts,
        ),
      }));
    case 'custom-counter-saved': {
      const exists = state.customCounters.some((c) => c.id === event.counter.id);
      if (!exists && state.customCounters.length >= MAX_CUSTOM_COUNTERS) return state;
      const customCounters = exists
        ? state.customCounters.map((c) => (c.id === event.counter.id ? event.counter : c))
        : [...state.customCounters, event.counter];
      // New limits apply to values that are already there.
      const fit = (values: Readonly<Record<string, number>>) =>
        event.counter.id in values
          ? { ...values, [event.counter.id]: clampToCounter(event.counter, values[event.counter.id]!) }
          : values;
      return {
        ...state,
        customCounters,
        tableCounters: fit(state.tableCounters),
        seats: state.seats.map((seat) => ({ ...seat, custom: fit(seat.custom) })),
      };
    }
    case 'custom-counter-removed':
      return { ...state, customCounters: state.customCounters.filter((c) => c.id !== event.id) };
    case 'custom-counter-changed': {
      const counter = state.customCounters.find((c) => c.id === event.id);
      if (!counter || (counter.scope === 'table') !== (event.seat === null)) return state;
      const change = (values: Readonly<Record<string, number>>) => ({
        ...values,
        [counter.id]: clampToCounter(counter, counterValue(counter, values) + event.amount),
      });
      return event.seat === null
        ? { ...state, tableCounters: change(state.tableCounters) }
        : updateSeat(state, event.seat, (seat) => ({ ...seat, custom: change(seat.custom) }));
    }
    case 'deck-chosen':
      return updateSeat(state, event.seat, (seat) => ({
        ...seat,
        deck: event.deck,
        deckAnalysis: null,
        commanders:
          event.deck && event.deck.commanders.length > 0 ? event.deck.commanders.map((c) => c.name) : seat.commanders,
      }));
    case 'deck-analyzed':
      return updateSeat(state, event.seat, (seat) =>
        seat.deck?.name === event.deckName ? { ...seat, deckAnalysis: event.analysis } : seat,
      );
    case 'bracket-declared':
      return updateSeat(state, event.seat, (seat) => ({ ...seat, bracket: event.bracket }));
    case 'card-shown':
    case 'response-called':
      return state;
    case 'turn-order-set': {
      const first = event.order.find((seat) => !isOut(state, seat)) ?? event.order[0] ?? null;
      return { ...state, turnOrder: event.order, activeSeat: first, turn: 1, round: 1 };
    }
    case 'turn-passed':
      return passTurn(state, event.from);
    case 'new-game':
      return newGame(event.startingLife, state.number + 1, state);
    case 'undo':
      return state;
  }
}

/** Hands the turn to the next player in the order who isn't out. */
function passTurn(state: GameState, from: SeatIndex): GameState {
  const order = state.turnOrder;
  if (!order || state.activeSeat !== from) return state;
  const index = order.indexOf(from);
  for (let step = 1; step <= order.length; step++) {
    const next = order[(index + step) % order.length]!;
    if (isOut(state, next) && next !== from) continue;
    const wrapped = index + step >= order.length;
    return { ...state, activeSeat: next, turn: state.turn + 1, round: wrapped ? state.round + 1 : state.round };
  }
  return state;
}

export function applyEvents(state: GameState, events: Iterable<GameEvent>): GameState {
  let current = state;
  for (const event of events) current = applyEvent(current, event);
  return current;
}

/** Why the rules say this player has lost, or null if they haven't. */
export function lossReason(game: GameState, seatIndex: SeatIndex): LossReason | null {
  const seat = game.seats[seatIndex];
  if (!seat) return null;
  if (seat.life <= 0) return { kind: 'life' };
  if (seat.counters.poison >= POISON_LIMIT) return { kind: 'poison' };
  for (let from = 0; from < seat.commanderDamage.length; from++) {
    const damage = seat.commanderDamage[from]!;
    for (let commander = 0; commander < damage.length; commander++) {
      if (damage[commander]! >= COMMANDER_DAMAGE_LIMIT) {
        return { kind: 'commander-damage', from: from as SeatIndex, commander: commander as CommanderIndex };
      }
    }
  }
  for (const counter of game.customCounters) {
    if (hasReachedLoss(counter, counterValue(counter, seat.custom))) return { kind: 'custom-counter', counter };
  }
  return null;
}

/** The extra mana it costs to cast this commander again. */
export function commanderTax(seat: SeatGameState, commander: CommanderIndex): number {
  return (seat.commanderCasts[commander] ?? 0) * COMMANDER_TAX_PER_CAST;
}

/** Out by the rules, unless a player said otherwise (e.g. a card that stops them from losing). */
export function isOut(game: GameState, seat: SeatIndex): boolean {
  return game.seats[seat]?.outOverride ?? lossReason(game, seat) !== null;
}

/** Reads untrusted data (from the network) as a game event. Returns null if it isn't a valid one. */
export function toGameEvent(raw: unknown): GameEvent | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  switch (value.type) {
    case 'life-changed':
      return isSeatIndex(value.seat) && isChange(value.amount)
        ? { type: 'life-changed', seat: value.seat, amount: value.amount }
        : null;
    case 'commander-damage':
      return isSeatIndex(value.from) && isCommander(value.commander) && isSeatIndex(value.to) && isChange(value.amount)
        ? { type: 'commander-damage', from: value.from, commander: value.commander, to: value.to, amount: value.amount }
        : null;
    case 'commanders-named': {
      if (!isSeatIndex(value.seat) || !Array.isArray(value.names)) return null;
      const names = value.names;
      const valid =
        names.length >= 1 &&
        names.length <= MAX_COMMANDERS &&
        names.every((n) => typeof n === 'string' && n.trim().length <= MAX_COMMANDER_NAME_LENGTH);
      return valid ? { type: 'commanders-named', seat: value.seat, names: names.map((n: string) => n.trim()) } : null;
    }
    case 'out-set':
      return isSeatIndex(value.seat) && (value.out === null || typeof value.out === 'boolean')
        ? { type: 'out-set', seat: value.seat, out: value.out }
        : null;
    case 'counter-changed':
      return isSeatIndex(value.seat) && isPlayerCounter(value.counter) && isChange(value.amount)
        ? { type: 'counter-changed', seat: value.seat, counter: value.counter, amount: value.amount }
        : null;
    case 'commander-cast':
      return isSeatIndex(value.seat) && isCommander(value.commander) && (value.amount === 1 || value.amount === -1)
        ? { type: 'commander-cast', seat: value.seat, commander: value.commander, amount: value.amount }
        : null;
    case 'custom-counter-saved': {
      const counter = toCustomCounter(value.counter);
      return counter ? { type: 'custom-counter-saved', counter } : null;
    }
    case 'custom-counter-removed':
      return isCounterId(value.id) ? { type: 'custom-counter-removed', id: value.id } : null;
    case 'custom-counter-changed':
      return isCounterId(value.id) && (value.seat === null || isSeatIndex(value.seat)) && isChange(value.amount)
        ? { type: 'custom-counter-changed', id: value.id, seat: value.seat, amount: value.amount }
        : null;
    case 'deck-chosen': {
      if (!isSeatIndex(value.seat)) return null;
      if (value.deck === null) return { type: 'deck-chosen', seat: value.seat, deck: null };
      const deck = toDeckList(value.deck);
      return deck ? { type: 'deck-chosen', seat: value.seat, deck } : null;
    }
    case 'deck-analyzed': {
      const analysis = toDeckAnalysis(value.analysis);
      return isSeatIndex(value.seat) && typeof value.deckName === 'string' && value.deckName.length <= 60 && analysis
        ? { type: 'deck-analyzed', seat: value.seat, deckName: value.deckName, analysis }
        : null;
    }
    case 'bracket-declared':
      return isSeatIndex(value.seat) && (value.bracket === null || isBracket(value.bracket))
        ? { type: 'bracket-declared', seat: value.seat, bracket: value.bracket }
        : null;
    case 'card-shown': {
      const card = value.card as { id?: unknown; name?: unknown } | null;
      const valid =
        typeof card === 'object' &&
        card !== null &&
        typeof card.id === 'string' &&
        card.id.length > 0 &&
        card.id.length <= 64 &&
        typeof card.name === 'string' &&
        card.name.length > 0 &&
        card.name.length <= 160 &&
        (value.reason === 'cast' || value.reason === 'show');
      return valid
        ? {
            type: 'card-shown',
            card: { id: card.id as string, name: card.name as string },
            reason: value.reason as 'cast' | 'show',
          }
        : null;
    }
    case 'turn-order-set':
      return isSeatList(value.order) ? { type: 'turn-order-set', order: value.order } : null;
    case 'turn-passed':
      return isSeatIndex(value.from) ? { type: 'turn-passed', from: value.from } : null;
    case 'undo':
      return isEventId(value.target) ? { type: 'undo', target: value.target } : null;
    case 'response-called':
      return { type: 'response-called' };
    case 'new-game':
      return isWholeNumber(value.startingLife) && value.startingLife > 0 && value.startingLife <= MAX_STARTING_LIFE
        ? { type: 'new-game', startingLife: value.startingLife }
        : null;
    default:
      return null;
  }
}

function counterMaximum(counter: PlayerCounter): number {
  return counter === 'speed' ? MAX_SPEED : Number.POSITIVE_INFINITY;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Events that tell the table something without changing the game: a card shown, a call to wait. There's
 * nothing to undo about them.
 */
export function isAnnouncement(event: GameEvent): boolean {
  return event.type === 'card-shown' || event.type === 'response-called';
}

/** One to four different seats. */
export function isSeatList(value: unknown): value is SeatIndex[] {
  return (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= MAX_SEATS &&
    value.every(isSeatIndex) &&
    new Set(value).size === value.length
  );
}

/** The id a player gives each change when they send it. */
export function isEventId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

function isCounterId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(value);
}

function isPlayerCounter(value: unknown): value is PlayerCounter {
  return typeof value === 'string' && (PLAYER_COUNTERS as readonly string[]).includes(value);
}

function updateSeat(state: GameState, seat: SeatIndex, update: (seat: SeatGameState) => SeatGameState): GameState {
  return { ...state, seats: state.seats.map((s, index) => (index === seat ? update(s) : s)) };
}

/** One of the four seats. */
export function isSeatIndex(value: unknown): value is SeatIndex {
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
