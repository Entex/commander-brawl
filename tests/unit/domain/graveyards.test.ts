import {
  MAX_PERMANENTS,
  applyEvent,
  newGame,
  toGameEvent,
  type GameEvent,
  type GameState,
} from '@commander-brawl/domain';
import { describe, expect, it } from 'vitest';

const play = (...events: GameEvent[]): GameState =>
  events.reduce((state, event) => applyEvent(state, event), newGame());
const graveyard = (game: GameState) => game.seats[2]!.graveyard;
const permanents = (game: GameState) => game.seats[2]!.permanents;
const card = (id: string, name: string) => ({ id, name, cardId: name.toLowerCase() });

describe('a graveyard', () => {
  it('has the cards put there, newest on top', () => {
    const game = play(
      { type: 'card-to-graveyard', seat: 2, card: card('a', 'Sol Ring') },
      { type: 'card-to-graveyard', seat: 2, card: card('b', 'Rhystic Study') },
    );
    expect(graveyard(game).map((c) => c.name)).toEqual(['Rhystic Study', 'Sol Ring']);
  });

  it('takes a card from the battlefield, which leaves it', () => {
    const game = play(
      {
        type: 'permanent-added',
        seat: 2,
        permanent: { id: 'p', name: 'Atraxa', cardId: 'atraxa', token: false, count: 1, spot: { x: 0.5, y: 0.5 } },
      },
      { type: 'card-to-graveyard', seat: 2, card: card('g', 'Atraxa'), from: 'p' },
    );
    expect(permanents(game)).toEqual([]);
    expect(graveyard(game)).toEqual([{ id: 'g', name: 'Atraxa', cardId: 'atraxa' }]);
  });

  it('gives a card back to the battlefield, or lets it go', () => {
    let game = play(
      { type: 'card-to-graveyard', seat: 2, card: card('a', 'Atraxa') },
      { type: 'card-to-graveyard', seat: 2, card: card('b', 'Sol Ring') },
    );
    game = applyEvent(game, { type: 'graveyard-card-removed', seat: 2, id: 'a', name: 'Atraxa', returned: true });
    expect(graveyard(game).map((c) => c.id)).toEqual(['b']);
    expect(permanents(game)).toMatchObject([{ name: 'Atraxa', cardId: 'atraxa', count: 1, tapped: 0, spot: null }]);
    game = applyEvent(game, { type: 'graveyard-card-removed', seat: 2, id: 'b', name: 'Sol Ring', returned: false });
    expect(graveyard(game)).toEqual([]);
    expect(permanents(game)).toHaveLength(1);
  });

  it('takes a card from the battlefield once: asked twice (G pressed twice, two players at once), it goes there once', () => {
    const onBattlefield: GameEvent = {
      type: 'permanent-added',
      seat: 2,
      permanent: { id: 'p', name: 'Atraxa', cardId: 'atraxa', token: false, count: 1 },
    };
    const game = play(
      onBattlefield,
      { type: 'card-to-graveyard', seat: 2, card: card('g1', 'Atraxa'), from: 'p' },
      { type: 'card-to-graveyard', seat: 2, card: card('g2', 'Atraxa'), from: 'p' },
    );
    expect(graveyard(game).map((c) => c.id)).toEqual(['g1']);
  });

  it("keeps a card that can't go back to a full battlefield", () => {
    const full = Array.from({ length: MAX_PERMANENTS }, (_, i): GameEvent => ({
      type: 'permanent-added',
      seat: 2,
      permanent: { id: `p${i}`, name: 'Goblin', cardId: null, token: true, count: 1 },
    }));
    const game = play(
      ...full,
      { type: 'card-to-graveyard', seat: 2, card: card('a', 'Atraxa') },
      { type: 'graveyard-card-removed', seat: 2, id: 'a', name: 'Atraxa', returned: true },
    );
    expect(graveyard(game).map((c) => c.id)).toEqual(['a']);
    expect(permanents(game)).toHaveLength(MAX_PERMANENTS);
  });

  it('is empty in a new game', () => {
    const game = play(
      { type: 'card-to-graveyard', seat: 2, card: card('a', 'Sol Ring') },
      { type: 'new-game', startingLife: 40 },
    );
    expect(graveyard(game)).toEqual([]);
  });

  it.each([
    ['a card without a name', { type: 'card-to-graveyard', seat: 2, card: { id: 'a', name: ' ', cardId: null } }],
    ['a card from a strange permanent', { type: 'card-to-graveyard', seat: 2, card: card('a', 'X'), from: 7 }],
    ['taking out without saying how', { type: 'graveyard-card-removed', seat: 2, id: 'a', name: 'X' }],
  ])('refuses %s', (_case, event) => {
    expect(toGameEvent(event)).toBeNull();
  });
});
