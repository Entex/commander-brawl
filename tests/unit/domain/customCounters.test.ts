import {
  MAX_CUSTOM_COUNTERS,
  applyEvent,
  applyEvents,
  counterValue,
  hasReachedLoss,
  isOut,
  lossReason,
  newGame,
  startValue,
  toCustomCounter,
  toGameEvent,
  type CustomCounter,
  type GameEvent,
} from '@commander-brawl/domain';
import { describe, expect, it } from 'vitest';

const bounty: CustomCounter = {
  id: 'bounty',
  name: 'Bounty',
  color: 'red',
  scope: 'player',
  start: 0,
  min: 0,
  max: null,
  loseAt: 3,
};
const storm: CustomCounter = {
  id: 'storm',
  name: 'Storm',
  color: 'blue',
  scope: 'table',
  start: 0,
  min: 0,
  max: null,
  loseAt: null,
};
const saved = (counter: CustomCounter): GameEvent => ({ type: 'custom-counter-saved', counter });
const change = (id: string, seat: 0 | 1 | 2 | 3 | null, amount: number): GameEvent => ({
  type: 'custom-counter-changed',
  id,
  seat,
  amount,
});

describe('custom counters', () => {
  it('are added for everyone and start at zero', () => {
    const state = applyEvents(newGame(), [saved(bounty), saved(storm)]);
    expect(state.customCounters.map((c) => c.name)).toEqual(['Bounty', 'Storm']);
    expect(counterValue(bounty, state.seats[0]!.custom)).toBe(0);
  });

  it('keep a value per player, or one for the whole table', () => {
    const state = applyEvents(newGame(), [
      saved(bounty),
      saved(storm),
      change('bounty', 1, 2),
      change('storm', null, 5),
    ]);
    expect(counterValue(bounty, state.seats[1]!.custom)).toBe(2);
    expect(counterValue(bounty, state.seats[0]!.custom)).toBe(0);
    expect(counterValue(storm, state.tableCounters)).toBe(5);
  });

  it('ignore changes for the wrong scope or a counter that does not exist', () => {
    const before = applyEvents(newGame(), [saved(bounty), saved(storm)]);
    const after = applyEvents(before, [change('bounty', null, 1), change('storm', 0, 1), change('nope', 0, 1)]);
    expect(after).toEqual(before);
  });

  it('stay within their limits', () => {
    const capped: CustomCounter = { ...bounty, id: 'capped', min: -2, max: 5, loseAt: null };
    const state = applyEvents(newGame(), [saved(capped), change('capped', 0, 9), change('capped', 1, -9)]);
    expect(counterValue(capped, state.seats[0]!.custom)).toBe(5);
    expect(counterValue(capped, state.seats[1]!.custom)).toBe(-2);
  });

  it('apply new limits to existing values when edited', () => {
    const state = applyEvents(newGame(), [saved(bounty), change('bounty', 0, 8), saved({ ...bounty, max: 4 })]);
    expect(counterValue(bounty, state.seats[0]!.custom)).toBe(4);
  });

  it('knock a player out when the losing value is reached', () => {
    const state = applyEvents(newGame(), [saved(bounty), change('bounty', 2, 3)]);
    expect(lossReason(state, 2)).toEqual({ kind: 'custom-counter', counter: bounty });
    expect(isOut(state, 2)).toBe(true);
    expect(isOut(state, 0)).toBe(false);
  });

  it('can start anywhere and count down to the losing value', () => {
    const fuse: CustomCounter = { ...bounty, id: 'fuse', start: 20, min: 0, max: null, loseAt: 0 };
    const state = applyEvents(newGame(), [saved(fuse), change('fuse', 1, -19)]);
    expect(counterValue(fuse, state.seats[0]!.custom)).toBe(20);
    expect(counterValue(fuse, state.seats[1]!.custom)).toBe(1);
    expect(hasReachedLoss(fuse, 1)).toBe(false);
    expect(hasReachedLoss(fuse, 0)).toBe(true);
  });

  it('keep the start within the limits', () => {
    expect(startValue({ ...bounty, start: 0, min: 5, max: 20 })).toBe(5);
  });

  it('stay for the next game, with their values reset', () => {
    const state = applyEvents(newGame(), [
      saved(bounty),
      saved(storm),
      change('bounty', 0, 2),
      change('storm', null, 4),
      { type: 'new-game', startingLife: 40 },
    ]);
    expect(state.customCounters).toHaveLength(2);
    expect(counterValue(bounty, state.seats[0]!.custom)).toBe(0);
    expect(counterValue(storm, state.tableCounters)).toBe(0);
  });

  it('can be removed', () => {
    const state = applyEvents(newGame(), [saved(bounty), { type: 'custom-counter-removed', id: 'bounty' }]);
    expect(state.customCounters).toEqual([]);
  });

  it(`are limited to ${MAX_CUSTOM_COUNTERS} per table`, () => {
    let state = newGame();
    for (let i = 0; i < MAX_CUSTOM_COUNTERS + 2; i++) state = applyEvent(state, saved({ ...bounty, id: `c${i}` }));
    expect(state.customCounters).toHaveLength(MAX_CUSTOM_COUNTERS);
  });
});

describe('reading custom counters from the network', () => {
  it('accepts a valid definition and drops a losing value on table counters', () => {
    expect(toCustomCounter({ ...storm, loseAt: 7 })).toEqual(storm);
    expect(toGameEvent(saved(bounty))).toEqual(saved(bounty));
  });

  it.each([
    ['no name', { ...bounty, name: '  ' }],
    ['a long name', { ...bounty, name: 'x'.repeat(25) }],
    ['an unknown color', { ...bounty, color: 'chartreuse' }],
    ['an unknown scope', { ...bounty, scope: 'planet' }],
    ['lowest above highest', { ...bounty, min: 5, max: 2 }],
    ['a fractional limit', { ...bounty, max: 2.5 }],
    ['no start', { ...bounty, start: null }],
    ['a strange id', { ...bounty, id: 'has spaces' }],
  ])('rejects a counter with %s', (_case, raw) => {
    expect(toCustomCounter(raw)).toBeNull();
  });
});
