import { resolveAction, toGameAction, toGameEvent } from '@commander-brawl/domain';
import { describe, expect, it } from 'vitest';

/** Chance that comes out as given, in turn. */
const rigged =
  (...values: number[]) =>
  () =>
    values.shift() ?? 0;

describe('dice, coins and random picks', () => {
  it('the host rolls: any number of sides, several dice at once', () => {
    const action = toGameAction({ type: 'roll-dice', sides: 20, count: 3 })!;
    expect(resolveAction(action, rigged(0, 0.5, 0.999))).toEqual({
      type: 'dice-rolled',
      sides: 20,
      results: [1, 11, 20],
    });
  });

  it('flips coins and picks a seat', () => {
    expect(resolveAction({ type: 'flip-coins', count: 2 }, rigged(0.2, 0.7))).toEqual({
      type: 'coins-flipped',
      results: ['heads', 'tails'],
    });
    expect(resolveAction({ type: 'pick-seat', seats: [1, 3] }, rigged(0.6))).toEqual({
      type: 'seat-picked',
      seats: [1, 3],
      picked: 3,
    });
  });

  it("won't take a result from a player, only a request to roll", () => {
    for (const result of [
      { type: 'dice-rolled', sides: 20, results: [20] },
      { type: 'coins-flipped', results: ['heads'] },
      { type: 'seat-picked', seats: [0, 1], picked: 1 },
      { type: 'turn-order-set', order: [0, 1] },
    ]) {
      expect(toGameAction(result), result.type).toBeNull();
      // But they're fine in the log, where the host put them.
      expect(toGameEvent(result), result.type).not.toBeNull();
    }
  });

  it.each([
    ['a one-sided die', { type: 'roll-dice', sides: 1, count: 1 }],
    ['too many sides', { type: 'roll-dice', sides: 1001, count: 1 }],
    ['too many dice', { type: 'roll-dice', sides: 6, count: 11 }],
    ['no coins', { type: 'flip-coins', count: 0 }],
    ['nobody to pick from', { type: 'pick-seat', seats: [] }],
  ])('refuses %s', (_, raw) => {
    expect(toGameAction(raw)).toBeNull();
  });

  it('reads logged results only if they could have happened', () => {
    expect(toGameEvent({ type: 'dice-rolled', sides: 6, results: [7] })).toBeNull();
    expect(toGameEvent({ type: 'coins-flipped', results: ['edge'] })).toBeNull();
    expect(toGameEvent({ type: 'seat-picked', seats: [0, 1], picked: 2 })).toBeNull();
  });
});
