import {
  applyEvent,
  isUndoable,
  newGame,
  timeLeft,
  toGameEvent,
  type GameEvent,
  type GameState,
  type Phase,
  type Reminder,
  type SeatIndex,
} from '@commander-brawl/domain';
import { describe, expect, it } from 'vitest';

const MIN = 60_000;

function play(state: GameState, ...events: GameEvent[]): GameState {
  return events.reduce((game, event) => applyEvent(game, event), state);
}

const order = (...seats: SeatIndex[]): GameEvent => ({ type: 'turn-order-set', order: seats });
const pass = (from: SeatIndex): GameEvent => ({ type: 'turn-passed', from });
const phase = (to: Phase): GameEvent => ({ type: 'phase-set', phase: to });
const wait = (call: string, seat: SeatIndex): GameEvent => ({ type: 'response-called', call, seat });
const resolve = (id: string): GameEvent => ({ type: 'call-resolved', id });

function reminder(id: string, changes: Partial<Reminder> = {}): GameEvent {
  return {
    type: 'reminder-set',
    reminder: {
      id,
      seat: 1,
      phase: 'upkeep',
      turns: [],
      turn: null,
      text: 'Rhystic Study tax?',
      once: false,
      stop: false,
      ...changes,
    },
  };
}

describe('a call to wait', () => {
  const timer: GameEvent = { type: 'clock-set', settings: { kind: 'turn', minutes: 3 } };

  it('stays until someone resolves it, and holds the clock until then, past moving on', () => {
    let game = applyEvent(applyEvent(newGame(), timer, 0), order(0, 1), 0);
    game = applyEvent(game, wait('w1', 1), 1 * MIN);
    expect(game.calls).toEqual([
      { id: 'w1', kind: 'wait', seat: 1, text: '', phase: 'upkeep', activeSeat: 0, turn: 1 },
    ]);
    expect(game.clock?.running).toBeNull();

    // Moving on doesn't end it.
    game = applyEvent(game, phase('combat'), 5 * MIN);
    expect(game.calls).toHaveLength(1);
    expect(timeLeft(game.clock!, 0, 9 * MIN)).toBe(2 * MIN);

    game = applyEvent(game, resolve('w1'), 9 * MIN);
    expect(game.calls).toEqual([]);
    expect(game.clock?.running).toEqual({ seat: 0, since: 9 * MIN });
  });

  it('with others still open, the clock waits for the last one', () => {
    let game = applyEvent(applyEvent(newGame(), timer, 0), order(0, 1), 0);
    game = play(game, wait('a', 1), wait('b', 0), resolve('a'));
    expect(game.calls.map((c) => c.id)).toEqual(['b']);
    expect(game.clock?.running).toBeNull();
    expect(applyEvent(game, resolve('b'), MIN).clock?.running).not.toBeNull();
  });

  it("doesn't run a clock someone paused by hand when the calls are resolved", () => {
    let game = applyEvent(applyEvent(newGame(), timer, 0), order(0, 1), 0);
    game = play(game, { type: 'clock-paused' }, wait('a', 1), resolve('a'));
    expect(game.clock?.running).toBeNull();
  });

  it('from before calls were kept only pauses the clock, until the next phase', () => {
    let game = applyEvent(applyEvent(newGame(), timer, 0), order(0, 1), 0);
    game = applyEvent(game, { type: 'response-called' }, MIN);
    expect(game.calls).toEqual([]);
    expect(game.clock?.running).toBeNull();
    expect(applyEvent(game, phase('draw'), 2 * MIN).clock?.running).not.toBeNull();
  });

  it("can't be taken back, but resolving one can", () => {
    expect(isUndoable(wait('a', 1))).toBe(false);
    expect(isUndoable(resolve('a'))).toBe(true);
    expect(isUndoable(reminder('r'))).toBe(true);
  });
});

describe('a trigger reminder', () => {
  it("comes up when the game gets to its phase on a turn it's for", () => {
    let game = play(newGame(), reminder('r', { turns: [1] }), order(0, 1));
    expect(game.calls).toEqual([]);
    game = applyEvent(game, pass(0));
    expect(game.calls).toEqual([
      { id: 'r@2', kind: 'reminder', seat: 1, text: 'Rhystic Study tax?', phase: 'upkeep', activeSeat: 1, turn: 2 },
    ]);
  });

  it('on every turn comes up on the first one too, and again each turn, once a turn', () => {
    let game = play(newGame(), reminder('r', { phase: 'draw' }), order(0, 1), phase('draw'));
    expect(game.calls.map((c) => c.id)).toEqual(['r@1']);
    // Back and forth in the same turn: not again.
    game = play(game, resolve('r@1'), phase('upkeep'), phase('draw'));
    expect(game.calls).toEqual([]);
    game = play(game, pass(0), phase('draw'));
    expect(game.calls.map((c) => c.id)).toEqual(['r@2']);
    expect(game.reminders).toHaveLength(1);
  });

  it('just once is gone after it comes up', () => {
    const game = play(newGame(), reminder('r', { once: true }), order(0, 1));
    expect(game.calls).toHaveLength(1);
    expect(game.reminders).toEqual([]);
  });

  it('stops the game at its phase: moving past it ends there, and so does passing the turn early', () => {
    let game = play(newGame(), reminder('c', { phase: 'combat' }), reminder('e', { phase: 'end' }), order(0, 1));
    game = applyEvent(game, phase('main2'));
    expect(game.phase).toBe('combat');
    expect(game.calls.map((c) => c.id)).toEqual(['c@1']);
    game = applyEvent(game, resolve('c@1'));
    // Passing the turn goes to the end step's reminder first; passing again passes it.
    game = applyEvent(game, pass(0));
    expect(game).toMatchObject({ activeSeat: 0, phase: 'end' });
    expect(game.calls.map((c) => c.id)).toEqual(['e@1']);
    game = applyEvent(game, pass(0));
    expect(game.activeSeat).toBe(1);
  });

  it('can be kept to its setter until it comes up', () => {
    const hidden = reminder('h', { hidden: true });
    expect(toGameEvent(hidden)).toEqual(hidden);
    const game = play(newGame(), hidden, order(1, 0));
    expect(game.calls.map((c) => c.id)).toEqual(['h@1']);
  });

  it('can be taken away before it comes up', () => {
    const game = play(newGame(), reminder('r'), { type: 'reminder-removed', id: 'r' }, order(0, 1));
    expect(game.calls).toEqual([]);
  });

  it('are gone in a new game, and so are the calls', () => {
    const game = play(newGame(), reminder('r'), order(0, 1), { type: 'new-game', startingLife: 40 });
    expect(game.reminders).toEqual([]);
    expect(game.calls).toEqual([]);
  });
});

describe('a stop', () => {
  // Seat 1 asks to stop at seat 0's combat, on turn 1.
  const stop = reminder('s', { phase: 'combat', turns: [0], turn: 1, text: '', once: true, stop: true });

  it('halts the active player at its phase when they move past it', () => {
    let game = play(newGame(), order(0, 1), stop, phase('end'));
    expect(game.phase).toBe('combat');
    expect(game.calls).toEqual([
      { id: 's@1', kind: 'stop', seat: 1, text: '', phase: 'combat', activeSeat: 0, turn: 1 },
    ]);
    // Only once: then they can go on.
    game = applyEvent(game, phase('end'));
    expect(game.phase).toBe('end');
  });

  it('keeps the turn from passing, at its phase', () => {
    let game = play(newGame(), order(0, 1), stop, phase('main1'), pass(0));
    expect(game).toMatchObject({ activeSeat: 0, turn: 1, phase: 'combat' });
    game = applyEvent(game, pass(0));
    expect(game).toMatchObject({ activeSeat: 1, turn: 2, phase: 'upkeep' });
  });

  it("for a turn that's over is gone", () => {
    const later = reminder('s', { phase: 'upkeep', turns: [0], turn: 1, once: true, stop: true });
    // Set during the draw step: its phase has gone by, and then so has the turn.
    const game = play(newGame(), order(0, 1), phase('draw'), later, pass(0));
    expect(game.reminders).toEqual([]);
  });
});

describe('reading calls and reminders from the network', () => {
  it('takes valid ones', () => {
    expect(toGameEvent(wait('abc-1', 2))).toEqual(wait('abc-1', 2));
    expect(toGameEvent(reminder('r'))).toEqual(reminder('r'));
    expect(toGameEvent({ type: 'call-resolved', id: 'r@12', kind: 'reminder', seat: 1 })).toEqual({
      type: 'call-resolved',
      id: 'r@12',
      kind: 'reminder',
      seat: 1,
    });
  });

  it.each([
    ['a reminder with too long a text', reminder('r', { text: 'x'.repeat(121) })],
    ['a reminder on no phase', reminder('r', { phase: 'untap' as Phase })],
    ['a reminder for the same seat twice', reminder('r', { turns: [1, 1] })],
    ['a reminder with a strange id', reminder('r r')],
    ['resolving nothing', { type: 'call-resolved', id: '' }],
  ])('refuses %s', (_case, event) => {
    expect(toGameEvent(event)).toBeNull();
  });
});
