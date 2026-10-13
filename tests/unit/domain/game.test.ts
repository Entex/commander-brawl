import {
  COMMANDER_DAMAGE_LIMIT,
  MAX_CHANGE,
  STARTING_LIFE,
  applyEvent,
  applyEvents,
  isOut,
  lossReason,
  newGame,
  toGameEvent,
  type GameEvent,
} from '@commander-brawl/domain';
import { describe, expect, it } from 'vitest';

describe('game state', () => {
  it('starts every seat at 40 life', () => {
    expect(newGame().seats.map((s) => s.life)).toEqual([STARTING_LIFE, STARTING_LIFE, STARTING_LIFE, STARTING_LIFE]);
    expect(newGame().number).toBe(1);
  });

  it('applies life changes to one seat', () => {
    const state = applyEvent(newGame(), { type: 'life-changed', seat: 2, amount: -7 });
    expect(state.seats.map((s) => s.life)).toEqual([40, 40, 33, 40]);
  });

  it('adds up changes made at the same time instead of one overwriting the other', () => {
    const events: GameEvent[] = [
      { type: 'life-changed', seat: 0, amount: -3 },
      { type: 'life-changed', seat: 0, amount: -5 },
    ];
    expect(applyEvents(newGame(), events).seats[0]!.life).toBe(32);
    expect(applyEvents(newGame(), [...events].reverse()).seats[0]!.life).toBe(32);
  });

  it('lets life go below zero; the game decides what that means', () => {
    expect(applyEvent(newGame(), { type: 'life-changed', seat: 0, amount: -45 }).seats[0]!.life).toBe(-5);
  });

  it('starts a new game with fresh life totals and counts the games', () => {
    const played = applyEvent(newGame(), { type: 'life-changed', seat: 1, amount: -10 });
    const next = applyEvent(played, { type: 'new-game', startingLife: 30 });
    expect(next.number).toBe(2);
    expect(next.seats.every((s) => s.life === 30)).toBe(true);
  });

  it('never changes the state it was given', () => {
    const state = newGame();
    applyEvent(state, { type: 'life-changed', seat: 0, amount: -1 });
    expect(state.seats[0]!.life).toBe(40);
  });
});

describe('commander damage', () => {
  const damage = (amount: number, commander: 0 | 1 = 0): GameEvent => ({ type: 'commander-damage', from: 1, commander, to: 0, amount });

  it('counts per commander and also comes off life', () => {
    const state = applyEvents(newGame(), [damage(5), damage(3, 1), damage(2)]);
    expect(state.seats[0]!.commanderDamage[1]).toEqual([7, 3]);
    expect(state.seats[0]!.life).toBe(30);
  });

  it('can be taken back, which gives the life back too', () => {
    const state = applyEvents(newGame(), [damage(5), damage(-2)]);
    expect(state.seats[0]!.commanderDamage[1]![0]).toBe(3);
    expect(state.seats[0]!.life).toBe(37);
  });

  it('knocks a player out at 21 from a single commander, but not from two added together', () => {
    const split = applyEvents(newGame(), [damage(20), damage(20, 1)]);
    expect(split.seats[0]!.life).toBe(0);
    expect(lossReason({ ...split.seats[0]!, life: 40 })).toBeNull();

    const lethal = applyEvent(newGame(), damage(COMMANDER_DAMAGE_LIMIT));
    expect(lossReason(lethal.seats[0]!)).toEqual({ kind: 'commander-damage', from: 1, commander: 0 });
    expect(isOut(lethal.seats[0]!)).toBe(true);
  });
});

describe('being out', () => {
  it('follows the rules: 0 life or less is out', () => {
    const state = applyEvent(newGame(), { type: 'life-changed', seat: 2, amount: -40 });
    expect(lossReason(state.seats[2]!)).toEqual({ kind: 'life' });
    expect(isOut(state.seats[2]!)).toBe(true);
  });

  it('can be set by hand either way, and handed back to the rules', () => {
    let state = applyEvent(newGame(), { type: 'life-changed', seat: 0, amount: -40 });
    state = applyEvent(state, { type: 'out-set', seat: 0, out: false });
    expect(isOut(state.seats[0]!)).toBe(false);
    state = applyEvent(state, { type: 'out-set', seat: 0, out: null });
    expect(isOut(state.seats[0]!)).toBe(true);

    const conceded = applyEvent(newGame(), { type: 'out-set', seat: 1, out: true });
    expect(isOut(conceded.seats[1]!)).toBe(true);
    expect(lossReason(conceded.seats[1]!)).toBeNull();
  });
});

describe('commanders', () => {
  it('can be named, with a partner, and are kept for the next game', () => {
    let state = applyEvent(newGame(), { type: 'commanders-named', seat: 3, names: ['Tymna', 'Kraum'] });
    state = applyEvent(state, { type: 'commander-damage', from: 3, commander: 1, to: 0, amount: 4 });
    state = applyEvent(state, { type: 'out-set', seat: 2, out: true });

    const next = applyEvent(state, { type: 'new-game', startingLife: 40 });

    expect(next.seats[3]!.commanders).toEqual(['Tymna', 'Kraum']);
    expect(next.seats[0]!.commanderDamage[3]).toEqual([0, 0]);
    expect(next.seats[2]!.outOverride).toBeNull();
  });
});

describe('reading game events from the network', () => {
  it('accepts valid events', () => {
    expect(toGameEvent({ type: 'life-changed', seat: 3, amount: 5 })).toEqual({ type: 'life-changed', seat: 3, amount: 5 });
    expect(toGameEvent({ type: 'new-game', startingLife: 40 })).toEqual({ type: 'new-game', startingLife: 40 });
  });

  it('trims commander names', () => {
    expect(toGameEvent({ type: 'commanders-named', seat: 1, names: ['  Atraxa ', ''] })).toEqual({
      type: 'commanders-named',
      seat: 1,
      names: ['Atraxa', ''],
    });
  });

  it('drops extra fields', () => {
    expect(toGameEvent({ type: 'life-changed', seat: 0, amount: 1, sneaky: true })).toEqual({
      type: 'life-changed',
      seat: 0,
      amount: 1,
    });
  });

  it.each([
    ['nothing', null],
    ['unknown type', { type: 'mill', seat: 0 }],
    ['seat out of range', { type: 'life-changed', seat: 4, amount: 1 }],
    ['zero change', { type: 'life-changed', seat: 0, amount: 0 }],
    ['fractional change', { type: 'life-changed', seat: 0, amount: 1.5 }],
    ['huge change', { type: 'life-changed', seat: 0, amount: MAX_CHANGE + 1 }],
    ['text instead of a number', { type: 'life-changed', seat: 0, amount: '-3' }],
    ['no starting life', { type: 'new-game' }],
    ['a third commander', { type: 'commanders-named', seat: 0, names: ['a', 'b', 'c'] }],
    ['no commanders', { type: 'commanders-named', seat: 0, names: [] }],
    ['a very long commander name', { type: 'commanders-named', seat: 0, names: ['x'.repeat(41)] }],
    ['commander damage from a third commander', { type: 'commander-damage', from: 0, commander: 2, to: 1, amount: 1 }],
    ['an unclear out status', { type: 'out-set', seat: 0, out: 'yes' }],
    ['starting life of zero', { type: 'new-game', startingLife: 0 }],
  ])('rejects %s', (_case, raw) => {
    expect(toGameEvent(raw)).toBeNull();
  });
});
