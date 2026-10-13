import {
  applyEvent,
  isUndoable,
  newGame,
  rollPlanarDie,
  toGameAction,
  type GameEvent,
  type GameState,
  type Scheme,
} from '@commander-brawl/domain';
import { describe, expect, it } from 'vitest';

const planes = [
  { id: 'a', name: 'Academy' },
  { id: 'b', name: 'Bant' },
  { id: 'c', name: 'Chaotic Aether' },
];
const schemes: Scheme[] = [
  { id: 's1', name: 'Plan One', ongoing: false },
  { id: 's2', name: 'Plan Two', ongoing: true },
];
const play = (...events: GameEvent[]): GameState =>
  events.reduce((state, event) => applyEvent(state, event), newGame());

describe('Planechase', () => {
  it('has a planar die with one planeswalk side and one chaos side in six', () => {
    expect([0, 1 / 6, 2 / 6, 5 / 6].map((r) => rollPlanarDie(() => r))).toEqual([
      'planeswalk',
      'chaos',
      'blank',
      'blank',
    ]);
  });

  it('starts on the first plane; rolling planeswalk, or planeswalking, moves on round the deck', () => {
    let game = play({ type: 'planechase-started', deck: planes });
    expect(game.planechase).toMatchObject({ index: 0, rollsThisTurn: 0 });
    game = applyEvent(game, { type: 'planar-die-rolled', result: 'chaos' });
    game = applyEvent(game, { type: 'planar-die-rolled', result: 'planeswalk' });
    expect(game.planechase).toMatchObject({ index: 1, rollsThisTurn: 2 });
    game = applyEvent(game, { type: 'planeswalked', to: planes[2]! });
    game = applyEvent(game, { type: 'planeswalked', to: planes[0]! });
    expect(game.planechase?.index).toBe(0);
  });

  it("ignores a planeswalk to a plane that isn't next (someone got there first)", () => {
    const game = play({ type: 'planechase-started', deck: planes }, { type: 'planeswalked', to: planes[1]! });
    expect(applyEvent(game, { type: 'planeswalked', to: planes[1]! })).toBe(game);
  });

  it('makes the planar die free again every turn', () => {
    const game = play(
      { type: 'planechase-started', deck: planes },
      { type: 'turn-order-set', order: [0, 1] },
      { type: 'planar-die-rolled', result: 'blank' },
      { type: 'turn-passed', from: 0 },
    );
    expect(game.planechase?.rollsThisTurn).toBe(0);
  });
});

describe('Archenemy', () => {
  it('sets schemes in motion one by one; ongoing ones stay until abandoned', () => {
    let game = play({ type: 'archenemy-started', seat: 2, deck: schemes });
    expect(game.archenemy).toMatchObject({ seat: 2, index: -1, ongoing: [] });
    game = applyEvent(game, { type: 'scheme-set-in-motion', scheme: schemes[0]! });
    game = applyEvent(game, { type: 'scheme-set-in-motion', scheme: schemes[1]! });
    expect(game.archenemy?.ongoing).toEqual([schemes[1]]);
    // Round the deck again: the ongoing scheme isn't in play twice.
    game = applyEvent(game, { type: 'scheme-set-in-motion', scheme: schemes[0]! });
    game = applyEvent(game, { type: 'scheme-set-in-motion', scheme: schemes[1]! });
    expect(game.archenemy?.ongoing).toHaveLength(1);
    game = applyEvent(game, { type: 'scheme-abandoned', id: 's2' });
    expect(game.archenemy?.ongoing).toEqual([]);
  });

  it('goes on into the next game from a fresh start; Planechase where its deck is', () => {
    const game = play(
      { type: 'planechase-started', deck: planes },
      { type: 'planeswalked', to: planes[1]! },
      { type: 'archenemy-started', seat: 0, deck: schemes },
      { type: 'scheme-set-in-motion', scheme: schemes[0]! },
      { type: 'new-game', startingLife: 40 },
    );
    expect(game.planechase?.index).toBe(1);
    expect(game.archenemy).toMatchObject({ seat: 0, index: -1, ongoing: [] });
  });
});

describe('fair play', () => {
  it('the host shuffles the decks and rolls the planar die; players only ask', () => {
    expect(toGameAction({ type: 'start-planechase', deck: planes })).not.toBeNull();
    expect(toGameAction({ type: 'planechase-started', deck: planes })).toBeNull();
    expect(toGameAction({ type: 'planar-die-rolled', result: 'planeswalk' })).toBeNull();
    expect(toGameAction({ type: 'archenemy-started', seat: 0, deck: schemes })).toBeNull();
  });

  it("results of chance can't be taken back, or a player could roll until they like it", () => {
    expect(isUndoable({ type: 'planar-die-rolled', result: 'blank' })).toBe(false);
    expect(isUndoable({ type: 'turn-order-set', order: [0, 1] })).toBe(false);
    expect(isUndoable({ type: 'planeswalked', to: planes[0]! })).toBe(true);
  });
});
