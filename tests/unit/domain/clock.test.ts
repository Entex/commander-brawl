import {
  applyEvent,
  newGame,
  timeLeft,
  toGameEvent,
  type GameEvent,
  type GameState,
  type SeatIndex,
} from '@commander-brawl/domain';
import { describe, expect, it } from 'vitest';

const MIN = 60_000;

/** Applies events at the given host times. */
function play(...steps: [at: number, event: GameEvent][]): GameState {
  return steps.reduce((state, [at, event]) => applyEvent(state, event, at), newGame());
}

const order = (...seats: SeatIndex[]): GameEvent => ({ type: 'turn-order-set', order: seats });
const pass = (from: SeatIndex): GameEvent => ({ type: 'turn-passed', from });

describe('phases', () => {
  it('start at the upkeep, follow the active player, and start over each turn', () => {
    let game = play([0, order(0, 1)]);
    expect(game.phase).toBe('upkeep');
    game = applyEvent(game, { type: 'phase-set', phase: 'attackers' });
    expect(game.phase).toBe('attackers');
    game = applyEvent(game, pass(0));
    expect(game).toMatchObject({ activeSeat: 1, phase: 'upkeep' });
    expect(applyEvent(game, { type: 'new-game', startingLife: 40 }).phase).toBeNull();
  });
});

describe('a turn timer', () => {
  const timer: GameEvent = { type: 'clock-set', settings: { kind: 'turn', minutes: 3 } };

  it('counts down for the active player and starts over each turn', () => {
    // Chosen before the game starts: nothing runs until the first turn.
    let game = play([1_000, timer]);
    expect(game.clock?.running).toBeNull();
    game = applyEvent(game, order(2, 0), 5_000);
    expect(timeLeft(game.clock!, 2, 5_000 + 1 * MIN)).toBe(2 * MIN);
    expect(timeLeft(game.clock!, 2, 5_000 + 4 * MIN)).toBe(-1 * MIN);

    game = applyEvent(game, pass(2), 5_000 + 2 * MIN);
    expect(game.clock?.running).toEqual({ seat: 0, since: 5_000 + 2 * MIN });
    expect(timeLeft(game.clock!, 0, 5_000 + 2.5 * MIN)).toBe(2.5 * MIN);
    // Back to the first player: a fresh three minutes.
    game = applyEvent(game, pass(0), 5_000 + 3 * MIN);
    expect(timeLeft(game.clock!, 2, 5_000 + 3 * MIN)).toBe(3 * MIN);
  });

  it('pauses for a response, and goes on when the active player moves on', () => {
    let game = play([0, timer], [0, order(0, 1)]);
    game = applyEvent(game, { type: 'response-called' }, 1 * MIN);
    expect(game.clock).toMatchObject({ running: null, paused: true });
    // However long the response takes.
    expect(timeLeft(game.clock!, 0, 10 * MIN)).toBe(2 * MIN);
    game = applyEvent(game, { type: 'phase-set', phase: 'combat' }, 10 * MIN);
    expect(game.clock?.running).toEqual({ seat: 0, since: 10 * MIN });
    expect(timeLeft(game.clock!, 0, 10.5 * MIN)).toBe(1.5 * MIN);
  });

  it('can be paused and resumed by hand, and turned off', () => {
    let game = play([0, timer], [0, order(0, 1)], [MIN, { type: 'clock-paused' }]);
    expect(timeLeft(game.clock!, 0, 5 * MIN)).toBe(2 * MIN);
    game = applyEvent(game, { type: 'clock-resumed' }, 5 * MIN);
    expect(timeLeft(game.clock!, 0, 6 * MIN)).toBe(1 * MIN);
    expect(applyEvent(game, { type: 'clock-set', settings: null }).clock).toBeNull();
  });

  it('stays for the next game, starting over with its first turn', () => {
    let game = play([0, timer], [0, order(0, 1)], [MIN, { type: 'new-game', startingLife: 40 }]);
    expect(game.clock).toMatchObject({ settings: { kind: 'turn', minutes: 3 }, running: null });
    game = applyEvent(game, order(1, 0), 2 * MIN);
    expect(timeLeft(game.clock!, 1, 2 * MIN)).toBe(3 * MIN);
  });
});

describe('a chess clock', () => {
  it("keeps each player's time over the whole game", () => {
    const game = play(
      [0, { type: 'clock-set', settings: { kind: 'chess', minutes: 20 } }],
      [0, order(0, 1)],
      [2 * MIN, pass(0)],
      [5 * MIN, pass(1)],
      [6 * MIN, pass(0)],
    );
    // Seat 0 used 2 + 1 minutes, seat 1 used 3 and is on the clock again since minute 6.
    expect(timeLeft(game.clock!, 0, 7 * MIN)).toBe(17 * MIN);
    expect(timeLeft(game.clock!, 1, 7 * MIN)).toBe(16 * MIN);
  });
});

describe('reading phase and clock events', () => {
  it('accepts valid ones', () => {
    expect(toGameEvent({ type: 'phase-set', phase: 'blockers' })).toEqual({ type: 'phase-set', phase: 'blockers' });
    expect(toGameEvent({ type: 'clock-set', settings: { kind: 'chess', minutes: 30, extra: 1 } })).toEqual({
      type: 'clock-set',
      settings: { kind: 'chess', minutes: 30 },
    });
    expect(toGameEvent({ type: 'clock-set', settings: null })).toEqual({ type: 'clock-set', settings: null });
    expect(toGameEvent({ type: 'clock-paused' })).toEqual({ type: 'clock-paused' });
  });

  it.each([
    ['an unknown phase', { type: 'phase-set', phase: 'second breakfast' }],
    ['no time at all', { type: 'clock-set', settings: { kind: 'turn', minutes: 0 } }],
    ['too much time', { type: 'clock-set', settings: { kind: 'chess', minutes: 10_000 } }],
    ['part of a minute', { type: 'clock-set', settings: { kind: 'turn', minutes: 2.5 } }],
    ['an unknown clock', { type: 'clock-set', settings: { kind: 'hourglass', minutes: 3 } }],
    ['no settings', { type: 'clock-set' }],
  ])('refuses %s', (_, raw) => {
    expect(toGameEvent(raw)).toBeNull();
  });
});
