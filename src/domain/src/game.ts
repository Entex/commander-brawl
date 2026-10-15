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
import { canVenture, isDungeonId, isLastRoom, type DayNight, type DungeonPosition } from './markers';
import {
  addPermanent,
  changeCount,
  changeCounter,
  changePermanent,
  changeTapped,
  isCounterKind,
  toNewPermanent,
  untapAll,
  type NewPermanent,
  type Permanent,
} from './permanents';
import { MAX_SEATS, type SeatIndex } from './table';
import {
  planeswalk,
  setSchemeInMotion,
  toSchemeDeck,
  toVariantDeck,
  type Archenemy,
  type PlanarDieResult,
  type Planechase,
  type Scheme,
  type VariantCard,
} from './variants';
import {
  clockForTurn,
  isPhase,
  newClock,
  pauseClock,
  runClock,
  toClockSettings,
  type Clock,
  type ClockSettings,
  type Phase,
} from './turns';

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
  /** Where the player is in a dungeon, if they've ventured into one. */
  readonly dungeon: DungeonPosition | null;
  readonly completedDungeons: number;
  /** Times the Ring has tempted this player. */
  readonly ringTempts: number;
  readonly citysBlessing: boolean;
  /** Cards with counters and groups of tokens the player keeps track of here. */
  readonly permanents: readonly Permanent[];
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
  /** Where the active player is in their turn, or null before the first turn. */
  readonly phase: Phase | null;
  readonly monarch: SeatIndex | null;
  /** Who has the initiative. */
  readonly initiative: SeatIndex | null;
  /** Null until a card makes it day or night. */
  readonly dayNight: DayNight | null;
  /** Spells cast this turn, by anyone. Starts over every turn. */
  readonly storm: number;
  readonly planechase: Planechase | null;
  readonly archenemy: Archenemy | null;
  /** The turn timer or chess clock, if the table uses one. */
  readonly clock: Clock | null;
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
  /** The active player moved on to this step of their turn (or back to it). */
  | { readonly type: 'phase-set'; readonly phase: Phase }
  /** Starts a turn timer or chess clock from scratch, or (null) does away with it. */
  | { readonly type: 'clock-set'; readonly settings: ClockSettings | null }
  | { readonly type: 'clock-paused' }
  | { readonly type: 'clock-resumed' }
  | { readonly type: 'monarch-set'; readonly seat: SeatIndex | null }
  /** Taking the initiative also ventures into Undercity, if the player isn't in a dungeon already. */
  | { readonly type: 'initiative-taken'; readonly seat: SeatIndex | null }
  /** Into a dungeon's first room, or on to a room the current one leads to. Anything else is ignored. */
  | { readonly type: 'ventured'; readonly seat: SeatIndex; readonly to: DungeonPosition }
  | { readonly type: 'ring-tempted'; readonly seat: SeatIndex; readonly amount: number }
  | { readonly type: 'citys-blessing-set'; readonly seat: SeatIndex; readonly has: boolean }
  | { readonly type: 'day-night-set'; readonly value: DayNight | null }
  | { readonly type: 'storm-changed'; readonly amount: number }
  /** Results of chance, recorded by the host (see GameIntent). Like a card shown, they change nothing. */
  | { readonly type: 'dice-rolled'; readonly sides: number; readonly results: readonly number[] }
  | { readonly type: 'coins-flipped'; readonly results: readonly CoinSide[] }
  | { readonly type: 'seat-picked'; readonly seats: readonly SeatIndex[]; readonly picked: SeatIndex }
  /** Planechase with this planar deck, shuffled by the host; the first plane is face up. */
  | { readonly type: 'planechase-started'; readonly deck: readonly VariantCard[] }
  /** Rolled by the host. Planeswalk moves to the next plane. */
  | { readonly type: 'planar-die-rolled'; readonly result: PlanarDieResult }
  /** On to this plane, the next in the deck (ignored if it isn't, because someone else got there first). */
  | { readonly type: 'planeswalked'; readonly to: VariantCard }
  | { readonly type: 'planechase-ended' }
  /** Archenemy with this player as the archenemy and this scheme deck, shuffled by the host. */
  | { readonly type: 'archenemy-started'; readonly seat: SeatIndex; readonly deck: readonly Scheme[] }
  /** Turns over this scheme, the next in the deck (ignored if it isn't). */
  | { readonly type: 'scheme-set-in-motion'; readonly scheme: VariantCard }
  | { readonly type: 'scheme-abandoned'; readonly id: string }
  | { readonly type: 'archenemy-ended' }
  | { readonly type: 'permanent-added'; readonly seat: SeatIndex; readonly permanent: NewPermanent }
  | { readonly type: 'permanent-removed'; readonly seat: SeatIndex; readonly id: string }
  /** More or fewer tokens in a group. */
  | { readonly type: 'permanent-count-changed'; readonly seat: SeatIndex; readonly id: string; readonly amount: number }
  /** Taps this many (untaps, if negative). */
  | { readonly type: 'permanent-tapped'; readonly seat: SeatIndex; readonly id: string; readonly amount: number }
  | {
      readonly type: 'permanent-counter-changed';
      readonly seat: SeatIndex;
      readonly id: string;
      readonly kind: string;
      readonly amount: number;
    }
  /** The checks on a deck are in. Only counts while that deck is still the one being played. */
  | {
      readonly type: 'deck-analyzed';
      readonly seat: SeatIndex;
      readonly deckName: string;
      readonly analysis: DeckAnalysis;
    }
  | { readonly type: 'bracket-declared'; readonly seat: SeatIndex; readonly bracket: Bracket | null }
  /**
   * Sets the turn order and starts the first turn. Shuffled by the host (see GameIntent): all of it, or (`firstOnly`)
   * just who goes first, the rest following in the order the players chose.
   */
  | { readonly type: 'turn-order-set'; readonly order: readonly SeatIndex[]; readonly firstOnly?: true }
  /** The players chose the turn order themselves, with no chance in it. Starts the first turn too. */
  | { readonly type: 'turn-order-chosen'; readonly order: readonly SeatIndex[] }
  /** Only counts if `from` still has the turn, so a double click can't skip a player. */
  | { readonly type: 'turn-passed'; readonly from: SeatIndex }
  | { readonly type: 'new-game'; readonly startingLife: number }
  /**
   * Takes back an earlier event, by its id in the game log. The state is then worked out as if that
   * event never happened, so this is handled where the whole log is known (see replayLog), not here.
   */
  | { readonly type: 'undo'; readonly target: string };

export type CoinSide = 'heads' | 'tails';

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
      dungeon: null,
      completedDungeons: 0,
      ringTempts: 0,
      citysBlessing: false,
      permanents: [],
    })),
    customCounters: previous?.customCounters ?? [],
    tableCounters: {},
    turnOrder: null,
    activeSeat: null,
    turn: 0,
    round: 0,
    phase: null,
    monarch: null,
    initiative: null,
    dayNight: null,
    storm: 0,
    // A variant goes on into the next game: Planechase where its deck is, Archenemy from a fresh start.
    planechase: previous?.planechase ? { ...previous.planechase, rollsThisTurn: 0 } : null,
    archenemy: previous?.archenemy ? { ...previous.archenemy, index: -1, ongoing: [] } : null,
    // Same clock as last game, started over once the first turn begins.
    clock: previous?.clock ? newClock(previous.clock.settings, null, 0) : null,
  };
}

/**
 * The game after this event. `at` is when it happened, on the host's clock (milliseconds since 1970): only the
 * turn timer or chess clock needs it.
 */
export function applyEvent(state: GameState, event: GameEvent, at = 0): GameState {
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
    case 'dice-rolled':
    case 'coins-flipped':
    case 'seat-picked':
      return state;
    case 'response-called':
      // Waiting for a response isn't anyone's time running out.
      return state.clock ? { ...state, clock: pauseClock(state.clock, at) } : state;
    case 'phase-set': {
      // Moving on means the response (or break) is over.
      const clock =
        state.clock?.paused && state.activeSeat !== null ? runClock(state.clock, state.activeSeat, at) : state.clock;
      return { ...state, phase: event.phase, clock };
    }
    case 'clock-set':
      return { ...state, clock: event.settings ? newClock(event.settings, state.activeSeat, at) : null };
    case 'clock-paused':
      return state.clock ? { ...state, clock: pauseClock(state.clock, at) } : state;
    case 'clock-resumed':
      return state.clock && state.activeSeat !== null && !state.clock.running
        ? { ...state, clock: runClock(state.clock, state.activeSeat, at) }
        : state;
    case 'monarch-set':
      return { ...state, monarch: event.seat };
    case 'initiative-taken': {
      const taken = { ...state, initiative: event.seat };
      return event.seat !== null && !state.seats[event.seat]?.dungeon
        ? venture(taken, event.seat, { dungeon: 'undercity', room: 0 })
        : taken;
    }
    case 'ventured':
      return venture(state, event.seat, event.to);
    case 'ring-tempted':
      return updateSeat(state, event.seat, (seat) => ({
        ...seat,
        ringTempts: Math.max(0, seat.ringTempts + event.amount),
      }));
    case 'citys-blessing-set':
      return updateSeat(state, event.seat, (seat) => ({ ...seat, citysBlessing: event.has }));
    case 'day-night-set':
      return { ...state, dayNight: event.value };
    case 'storm-changed':
      return { ...state, storm: Math.max(0, state.storm + event.amount) };
    case 'planechase-started':
      return { ...state, planechase: { deck: event.deck, index: 0, rollsThisTurn: 0 } };
    case 'planar-die-rolled': {
      if (!state.planechase) return state;
      const rolled = { ...state.planechase, rollsThisTurn: state.planechase.rollsThisTurn + 1 };
      return { ...state, planechase: event.result === 'planeswalk' ? planeswalk(rolled) : rolled };
    }
    case 'planeswalked': {
      const next = state.planechase && planeswalk(state.planechase);
      return next && next.deck[next.index]?.id === event.to.id ? { ...state, planechase: next } : state;
    }
    case 'planechase-ended':
      return { ...state, planechase: null };
    case 'archenemy-started':
      return { ...state, archenemy: { seat: event.seat, deck: event.deck, index: -1, ongoing: [] } };
    case 'scheme-set-in-motion': {
      const next = state.archenemy && setSchemeInMotion(state.archenemy);
      return next && next.deck[next.index]?.id === event.scheme.id ? { ...state, archenemy: next } : state;
    }
    case 'scheme-abandoned':
      return state.archenemy
        ? {
            ...state,
            archenemy: { ...state.archenemy, ongoing: state.archenemy.ongoing.filter((s) => s.id !== event.id) },
          }
        : state;
    case 'archenemy-ended':
      return { ...state, archenemy: null };
    case 'permanent-added':
      return updateSeat(state, event.seat, (seat) => ({
        ...seat,
        permanents: addPermanent(seat.permanents, event.permanent),
      }));
    case 'permanent-removed':
      return updateSeat(state, event.seat, (seat) => ({
        ...seat,
        permanents: seat.permanents.filter((p) => p.id !== event.id),
      }));
    case 'permanent-count-changed':
      return changeSeatPermanent(state, event.seat, event.id, (p) => changeCount(p, event.amount));
    case 'permanent-tapped':
      return changeSeatPermanent(state, event.seat, event.id, (p) => changeTapped(p, event.amount));
    case 'permanent-counter-changed':
      return changeSeatPermanent(state, event.seat, event.id, (p) => changeCounter(p, event.kind, event.amount));
    case 'turn-order-set':
    case 'turn-order-chosen': {
      const first = event.order.find((seat) => !isOut(state, seat)) ?? event.order[0] ?? null;
      return {
        ...state,
        storm: 0,
        planechase: state.planechase && { ...state.planechase, rollsThisTurn: 0 },
        turnOrder: event.order,
        activeSeat: first,
        turn: 1,
        round: 1,
        phase: first === null ? null : PHASES_START,
        clock: state.clock && first !== null ? newClock(state.clock.settings, first, at) : state.clock,
      };
    }
    case 'turn-passed': {
      const passed = passTurn(state, event.from);
      if (passed === state || passed.activeSeat === null) return passed;
      // The untap step: the new active player's permanents untap.
      const untapped = updateSeat(passed, passed.activeSeat, (seat) => ({
        ...seat,
        permanents: untapAll(seat.permanents),
      }));
      return {
        ...untapped,
        phase: PHASES_START,
        storm: 0,
        planechase: passed.planechase && { ...passed.planechase, rollsThisTurn: 0 },
        clock: passed.clock ? clockForTurn(passed.clock, passed.activeSeat, at) : null,
      };
    }
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

function changeSeatPermanent(
  state: GameState,
  seat: SeatIndex,
  id: string,
  change: (permanent: Permanent) => Permanent,
): GameState {
  return updateSeat(state, seat, (s) => ({ ...s, permanents: changePermanent(s.permanents, id, change) }));
}

/** Moves the player to that room, if venturing can take them there; finishing a dungeon counts. */
function venture(state: GameState, seatIndex: SeatIndex, to: DungeonPosition): GameState {
  const seat = state.seats[seatIndex];
  if (!seat || !canVenture(seat.dungeon, to)) return state;
  return updateSeat(state, seatIndex, () => ({
    ...seat,
    dungeon: to,
    completedDungeons: seat.completedDungeons + (isLastRoom(to) ? 1 : 0),
  }));
}

/** A turn starts at its upkeep. */
const PHASES_START: Phase = 'upkeep';

/** Applies the events in order, all at the same time `at` (see applyEvent). */
export function applyEvents(state: GameState, events: Iterable<GameEvent>, at = 0): GameState {
  let current = state;
  for (const event of events) current = applyEvent(current, event, at);
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
      if (!isSeatList(value.order)) return null;
      return value.firstOnly === true
        ? { type: 'turn-order-set', order: value.order, firstOnly: true }
        : { type: 'turn-order-set', order: value.order };
    case 'turn-order-chosen':
      return isSeatList(value.order) ? { type: 'turn-order-chosen', order: value.order } : null;
    case 'turn-passed':
      return isSeatIndex(value.from) ? { type: 'turn-passed', from: value.from } : null;
    case 'undo':
      return isEventId(value.target) ? { type: 'undo', target: value.target } : null;
    case 'response-called':
      return { type: 'response-called' };
    case 'phase-set':
      return isPhase(value.phase) ? { type: 'phase-set', phase: value.phase } : null;
    case 'clock-set': {
      if (value.settings === null) return { type: 'clock-set', settings: null };
      const settings = toClockSettings(value.settings);
      return settings ? { type: 'clock-set', settings } : null;
    }
    case 'clock-paused':
      return { type: 'clock-paused' };
    case 'clock-resumed':
      return { type: 'clock-resumed' };
    case 'monarch-set':
    case 'initiative-taken':
      return value.seat === null || isSeatIndex(value.seat) ? { type: value.type, seat: value.seat } : null;
    case 'ventured': {
      const to = value.to as Record<string, unknown> | null;
      return isSeatIndex(value.seat) &&
        typeof to === 'object' &&
        to !== null &&
        isDungeonId(to.dungeon) &&
        isWholeNumber(to.room) &&
        to.room >= 0 &&
        to.room < 20
        ? { type: 'ventured', seat: value.seat, to: { dungeon: to.dungeon, room: to.room } }
        : null;
    }
    case 'ring-tempted':
      return isSeatIndex(value.seat) && isChange(value.amount)
        ? { type: 'ring-tempted', seat: value.seat, amount: value.amount }
        : null;
    case 'citys-blessing-set':
      return isSeatIndex(value.seat) && typeof value.has === 'boolean'
        ? { type: 'citys-blessing-set', seat: value.seat, has: value.has }
        : null;
    case 'day-night-set':
      return value.value === null || value.value === 'day' || value.value === 'night'
        ? { type: 'day-night-set', value: value.value }
        : null;
    case 'storm-changed':
      return isChange(value.amount) ? { type: 'storm-changed', amount: value.amount } : null;
    case 'dice-rolled': {
      const { sides, results } = value;
      return isWholeNumber(sides) &&
        sides >= 2 &&
        sides <= 1000 &&
        Array.isArray(results) &&
        results.length >= 1 &&
        results.length <= 10 &&
        results.every((r) => isWholeNumber(r) && r >= 1 && r <= sides)
        ? { type: 'dice-rolled', sides, results: [...(results as number[])] }
        : null;
    }
    case 'coins-flipped': {
      const { results } = value;
      return Array.isArray(results) &&
        results.length >= 1 &&
        results.length <= 10 &&
        results.every((r) => r === 'heads' || r === 'tails')
        ? { type: 'coins-flipped', results: [...(results as CoinSide[])] }
        : null;
    }
    case 'seat-picked':
      return isSeatList(value.seats) && isSeatIndex(value.picked) && value.seats.includes(value.picked)
        ? { type: 'seat-picked', seats: value.seats, picked: value.picked }
        : null;
    case 'planechase-started': {
      const deck = toVariantDeck(value.deck);
      return deck ? { type: 'planechase-started', deck } : null;
    }
    case 'planar-die-rolled':
      return value.result === 'blank' || value.result === 'chaos' || value.result === 'planeswalk'
        ? { type: 'planar-die-rolled', result: value.result }
        : null;
    case 'planeswalked': {
      const to = toVariantDeck([value.to])?.[0];
      return to ? { type: 'planeswalked', to } : null;
    }
    case 'archenemy-started': {
      const deck = toSchemeDeck(value.deck);
      return deck && isSeatIndex(value.seat) ? { type: 'archenemy-started', seat: value.seat, deck } : null;
    }
    case 'scheme-set-in-motion': {
      const scheme = toVariantDeck([value.scheme])?.[0];
      return scheme ? { type: 'scheme-set-in-motion', scheme } : null;
    }
    case 'scheme-abandoned':
      return typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 64
        ? { type: 'scheme-abandoned', id: value.id }
        : null;
    case 'planechase-ended':
    case 'archenemy-ended':
      return { type: value.type };
    case 'permanent-added': {
      const permanent = toNewPermanent(value.permanent);
      return permanent && isSeatIndex(value.seat) ? { type: 'permanent-added', seat: value.seat, permanent } : null;
    }
    case 'permanent-removed':
      return isSeatIndex(value.seat) && isPermanentId(value.id)
        ? { type: 'permanent-removed', seat: value.seat, id: value.id }
        : null;
    case 'permanent-count-changed':
    case 'permanent-tapped':
      return isSeatIndex(value.seat) && isPermanentId(value.id) && isChange(value.amount)
        ? { type: value.type, seat: value.seat, id: value.id, amount: value.amount }
        : null;
    case 'permanent-counter-changed':
      return isSeatIndex(value.seat) && isPermanentId(value.id) && isCounterKind(value.kind) && isChange(value.amount)
        ? { type: 'permanent-counter-changed', seat: value.seat, id: value.id, kind: value.kind, amount: value.amount }
        : null;
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
  return (
    event.type === 'card-shown' ||
    event.type === 'response-called' ||
    event.type === 'dice-rolled' ||
    event.type === 'coins-flipped' ||
    event.type === 'seat-picked'
  );
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

function isPermanentId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 64;
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
