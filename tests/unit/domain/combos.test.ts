import {
  applyEvent,
  comboThreats,
  combosWith,
  newGame,
  sameCardName,
  toDeckAnalysis,
  type DeckAnalysis,
  type GameEvent,
  type GameState,
} from '@commander-brawl/domain';
import { describe, expect, it } from 'vitest';

const flicker = { cards: ['Ghostly Flicker', 'Peregrine Drake', 'Archaeomancer'], produces: ['Infinite mana'] };
const thoracle = { cards: ["Thassa's Oracle", 'Demonic Consultation'], produces: ['Win the game'] };
const analysis: DeckAnalysis = {
  gameChangers: [],
  massLandDenial: [],
  extraTurns: [],
  twoCardCombos: [thoracle],
  combos: [thoracle, flicker],
  complete: true,
};

function withBoard(...names: string[]): GameState {
  const events: GameEvent[] = [
    { type: 'deck-chosen', seat: 1, deck: { name: 'Blue', commanders: [], cards: [] } },
    { type: 'deck-analyzed', seat: 1, deckName: 'Blue', analysis },
    ...names.map((name, i): GameEvent => ({
      type: 'permanent-added',
      seat: 1,
      permanent: { id: `p${i}`, name, cardId: null, token: false, count: 1 },
    })),
  ];
  return events.reduce((state, event) => applyEvent(state, event), newGame());
}

describe('combo warnings', () => {
  it('warn when a player has all but one piece of a combo from their deck on the battlefield', () => {
    expect(comboThreats(withBoard('Peregrine Drake'))).toEqual([]);
    const threats = comboThreats(withBoard('Peregrine Drake', 'Archaeomancer'));
    expect(threats).toEqual([
      { seat: 1, combo: flicker, present: ['Peregrine Drake', 'Archaeomancer'], missing: ['Ghostly Flicker'] },
    ]);
  });

  it('put whole combos first', () => {
    const threats = comboThreats(withBoard("Thassa's Oracle", 'Peregrine Drake', 'Archaeomancer', 'Ghostly Flicker'));
    expect(threats.map((t) => [t.combo.cards.length, t.missing.length])).toEqual([
      [3, 0],
      [2, 1],
    ]);
  });

  it("know a double-faced card by its front face, and don't care about case or accents", () => {
    const game = withBoard('peregrine drake // Some Back Face', 'ARCHAEOMANCER');
    expect(comboThreats(game)).toHaveLength(1);
  });

  it('read analyses from before every combo was kept', () => {
    const { combos: _, ...old } = analysis;
    expect(toDeckAnalysis(old)).toEqual(old);
    expect(toDeckAnalysis({ ...analysis, combos: [{ cards: [''], produces: [] }] })).toBeNull();
  });
});

describe('the combos a card is part of', () => {
  it("are the ones in its player's deck with that card, fewest cards first", () => {
    const game = withBoard();
    expect(combosWith(game, 1, 'Demonic Consultation')).toEqual([thoracle]);
    expect(combosWith(game, 1, 'archaeomancer')).toEqual([flicker]);
    expect(combosWith(game, 1, 'Sol Ring')).toEqual([]);
    // Another player's deck has none.
    expect(combosWith(game, 0, 'Demonic Consultation')).toEqual([]);
  });

  it('match names however they are written', () => {
    expect(sameCardName("Thassa's Oracle", 'thassas oracle')).toBe(true);
    expect(sameCardName('Fire // Ice', 'Fire')).toBe(true);
    expect(sameCardName('Sol Ring', 'Sol Talisman')).toBe(false);
  });
});
