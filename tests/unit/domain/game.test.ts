import {
  MAX_LIFE_CHANGE,
  STARTING_LIFE,
  applyEvent,
  applyEvents,
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

describe('reading game events from the network', () => {
  it('accepts valid events', () => {
    expect(toGameEvent({ type: 'life-changed', seat: 3, amount: 5 })).toEqual({ type: 'life-changed', seat: 3, amount: 5 });
    expect(toGameEvent({ type: 'new-game', startingLife: 40 })).toEqual({ type: 'new-game', startingLife: 40 });
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
    ['huge change', { type: 'life-changed', seat: 0, amount: MAX_LIFE_CHANGE + 1 }],
    ['text instead of a number', { type: 'life-changed', seat: 0, amount: '-3' }],
    ['no starting life', { type: 'new-game' }],
    ['starting life of zero', { type: 'new-game', startingLife: 0 }],
  ])('rejects %s', (_case, raw) => {
    expect(toGameEvent(raw)).toBeNull();
  });
});
