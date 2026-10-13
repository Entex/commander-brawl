import {
  MAX_PERMANENTS,
  applyEvent,
  newGame,
  toCustomCounter,
  toGameEvent,
  type GameEvent,
  type GameState,
} from '@commander-brawl/domain';
import { describe, expect, it } from 'vitest';

const play = (...events: GameEvent[]): GameState =>
  events.reduce((state, event) => applyEvent(state, event), newGame());
const add = (id: string, name: string, token = false, count = 1): GameEvent => ({
  type: 'permanent-added',
  seat: 1,
  permanent: { id, name, cardId: token ? null : name.toLowerCase(), token, count },
});
const permanents = (game: GameState) => game.seats[1]!.permanents;

describe('cards and tokens on the battlefield', () => {
  it('keeps counters on a card: added, taken off, gone at zero', () => {
    let game = play(add('a', 'Atraxa'), {
      type: 'permanent-counter-changed',
      seat: 1,
      id: 'a',
      kind: '+1/+1',
      amount: 3,
    });
    expect(permanents(game)[0]).toMatchObject({ name: 'Atraxa', count: 1, tapped: 0, counters: { '+1/+1': 3 } });
    game = applyEvent(game, { type: 'permanent-counter-changed', seat: 1, id: 'a', kind: 'shield', amount: 1 });
    game = applyEvent(game, { type: 'permanent-counter-changed', seat: 1, id: 'a', kind: '+1/+1', amount: -5 });
    expect(permanents(game)[0]!.counters).toEqual({ shield: 1 });
  });

  it('counts tokens in a group, and how many are tapped', () => {
    let game = play(add('g', 'Goblin', true, 3), { type: 'permanent-tapped', seat: 1, id: 'g', amount: 5 });
    expect(permanents(game)[0]).toMatchObject({ count: 3, tapped: 3 });
    // Fewer tokens: fewer tapped too, and never fewer than one (taking the group away is separate).
    game = applyEvent(game, { type: 'permanent-count-changed', seat: 1, id: 'g', amount: -10 });
    expect(permanents(game)[0]).toMatchObject({ count: 1, tapped: 1 });
    game = applyEvent(game, { type: 'permanent-removed', seat: 1, id: 'g' });
    expect(permanents(game)).toEqual([]);
  });

  it("only tokens come in groups: a card's count stays one", () => {
    const game = play(add('a', 'Atraxa'), { type: 'permanent-count-changed', seat: 1, id: 'a', amount: 2 });
    expect(permanents(game)[0]!.count).toBe(1);
    expect(
      toGameEvent({
        ...add('b', 'Sol Ring'),
        permanent: { id: 'b', name: 'Sol Ring', cardId: null, token: false, count: 2 },
      }),
    ).toBeNull();
  });

  it("untaps a player's permanents when their turn starts, and only theirs", () => {
    let game = play(
      { type: 'turn-order-set', order: [1, 2] },
      add('g', 'Goblin', true, 2),
      { type: 'permanent-tapped', seat: 1, id: 'g', amount: 2 },
      { type: 'permanent-added', seat: 2, permanent: { id: 'h', name: 'Human', cardId: null, token: true, count: 1 } },
      { type: 'permanent-tapped', seat: 2, id: 'h', amount: 1 },
      { type: 'turn-passed', from: 1 },
    );
    expect(game.seats[2]!.permanents[0]!.tapped).toBe(0);
    expect(permanents(game)[0]!.tapped).toBe(2);
    game = applyEvent(game, { type: 'turn-passed', from: 2 });
    expect(permanents(game)[0]!.tapped).toBe(0);
  });

  it('ignores the same permanent twice, and more than fit', () => {
    let game = play(add('a', 'Atraxa'), add('a', 'Atraxa again'));
    expect(permanents(game)).toHaveLength(1);
    for (let i = 0; i < MAX_PERMANENTS + 5; i++) game = applyEvent(game, add(`t${i}`, 'Treasure', true));
    expect(permanents(game)).toHaveLength(MAX_PERMANENTS);
  });

  it('starts over with a new game', () => {
    expect(permanents(play(add('a', 'Atraxa'), { type: 'new-game', startingLife: 40 }))).toEqual([]);
  });

  it('can use a custom counter made for cards', () => {
    expect(
      toCustomCounter({
        id: 'doom',
        name: 'Doom',
        color: 'red',
        scope: 'card',
        start: 0,
        min: 0,
        max: null,
        loseAt: 5,
      }),
    ).toMatchObject({ scope: 'card', loseAt: null });
  });
});
