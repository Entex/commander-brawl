import {
  applyEvent,
  applyEvents,
  newGame,
  resolveAction,
  toGameAction,
  type GameEvent,
  type GameState,
  type SeatIndex,
} from '@commander-brawl/domain';
import { describe, expect, it } from 'vitest';

const order = (...seats: SeatIndex[]): GameEvent => ({ type: 'turn-order-set', order: seats });
const pass = (from: SeatIndex): GameEvent => ({ type: 'turn-passed', from });
const turnOf = (state: GameState) => ({ active: state.activeSeat, turn: state.turn, round: state.round });

describe('turns', () => {
  it('have no order until one is set, which starts the first turn', () => {
    expect(turnOf(newGame())).toEqual({ active: null, turn: 0, round: 0 });
    expect(turnOf(applyEvent(newGame(), order(2, 0, 1)))).toEqual({ active: 2, turn: 1, round: 1 });
  });

  it('go around the table in order, counting turns and rounds', () => {
    const state = applyEvents(newGame(), [order(2, 0, 1), pass(2), pass(0), pass(1)]);
    expect(turnOf(state)).toEqual({ active: 2, turn: 4, round: 2 });
  });

  it('only pass when the player passing still has the turn, so a double click cannot skip anyone', () => {
    const state = applyEvents(newGame(), [order(0, 1, 2), pass(0), pass(0)]);
    expect(turnOf(state)).toEqual({ active: 1, turn: 2, round: 1 });
  });

  it('skip players who are out', () => {
    const state = applyEvents(newGame(), [order(0, 1, 2), { type: 'out-set', seat: 1, out: true }, pass(0)]);
    expect(state.activeSeat).toBe(2);
  });

  it('start with the first player who is still in', () => {
    const state = applyEvents(newGame(), [{ type: 'life-changed', seat: 3, amount: -40 }, order(3, 1)]);
    expect(state.activeSeat).toBe(1);
  });

  it('start over in a new game', () => {
    const state = applyEvents(newGame(), [order(0, 1), pass(0), { type: 'new-game', startingLife: 40 }]);
    expect(state.turnOrder).toBeNull();
    expect(turnOf(state)).toEqual({ active: null, turn: 0, round: 0 });
  });
});

describe('shuffling the turn order', () => {
  it('is decided by whoever resolves the action, from the seats asked for', () => {
    const action = toGameAction({ type: 'randomize-turn-order', seats: [0, 1, 2, 3] })!;
    const alwaysLow = () => 0;
    const event = resolveAction(action, alwaysLow);
    expect(event.type).toBe('turn-order-set');
    expect(event.type === 'turn-order-set' && [...event.order].sort()).toEqual([0, 1, 2, 3]);
  });

  it('gives every order a chance', () => {
    const action = toGameAction({ type: 'randomize-turn-order', seats: [0, 1, 2] })!;
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const event = resolveAction(action, Math.random);
      if (event.type === 'turn-order-set') seen.add(event.order.join(''));
    }
    expect(seen.size).toBe(6);
  });

  it('passes ordinary events through unchanged', () => {
    const event: GameEvent = { type: 'life-changed', seat: 0, amount: -1 };
    expect(resolveAction(event, Math.random)).toBe(event);
  });

  it.each([
    ['no seats', []],
    ['the same seat twice', [1, 1]],
    ['a seat that does not exist', [0, 4]],
    ['five seats', [0, 1, 2, 3, 0]],
  ])('rejects %s', (_case, seats) => {
    expect(toGameAction({ type: 'randomize-turn-order', seats })).toBeNull();
    expect(toGameAction({ type: 'turn-order-set', order: seats })).toBeNull();
  });
});
