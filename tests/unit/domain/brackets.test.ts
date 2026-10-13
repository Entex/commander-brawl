import {
  applyEvents,
  bracketConcerns,
  newGame,
  toDeckAnalysis,
  toGameEvent,
  type DeckAnalysis,
  type DeckList,
} from '@commander-brawl/domain';
import { describe, expect, it } from 'vitest';

const clean: DeckAnalysis = { gameChangers: [], massLandDenial: [], extraTurns: [], twoCardCombos: [], complete: true };
const deck: DeckList = { name: 'Atraxa', commanders: [{ id: 'a', name: 'Atraxa', count: 1 }], cards: [] };

describe('bracket concerns', () => {
  it('has none for a deck that fits', () => {
    expect(bracketConcerns(2, clean)).toEqual([]);
    expect(
      bracketConcerns(4, { ...clean, gameChangers: ['A', 'B', 'C', 'D'], massLandDenial: ['Armageddon'] }),
    ).toEqual([]);
  });

  it('points out Game Changers in brackets 1–2, and more than three in bracket 3', () => {
    expect(bracketConcerns(2, { ...clean, gameChangers: ['Rhystic Study'] })).toEqual([
      '1 Game Changer (brackets 1–2 have none): Rhystic Study',
    ]);
    expect(bracketConcerns(3, { ...clean, gameChangers: ['A', 'B', 'C'] })).toEqual([]);
    expect(bracketConcerns(3, { ...clean, gameChangers: ['A', 'B', 'C', 'D'] })).toEqual([
      '4 Game Changers (bracket 3 allows 3): A, B, C, D',
    ]);
  });

  it('points out land denial, extra turns and two-card combos below bracket 4', () => {
    const concerns = bracketConcerns(3, {
      ...clean,
      massLandDenial: ['Armageddon'],
      extraTurns: ['Time Warp'],
      twoCardCombos: [{ cards: ["Thassa's Oracle", 'Demonic Consultation'], produces: ['Win the game'] }],
    });
    expect(concerns).toEqual([
      'Mass land denial (brackets 1–3 avoid it): Armageddon',
      "Extra turns (brackets 1–3 don't chain them): Time Warp",
      "Two-card combos (bracket 3 keeps them for late in the game): Thassa's Oracle + Demonic Consultation",
    ]);
  });
});

describe('brackets at the table', () => {
  it('keeps the declared bracket and the deck check for the next game', () => {
    const state = applyEvents(newGame(), [
      { type: 'deck-chosen', seat: 1, deck },
      { type: 'deck-analyzed', seat: 1, deckName: 'Atraxa', analysis: clean },
      { type: 'bracket-declared', seat: 1, bracket: 3 },
      { type: 'new-game', startingLife: 40 },
    ]);
    expect(state.seats[1]).toMatchObject({ bracket: 3, deckAnalysis: clean });
  });

  it('ignores a check for a deck that is no longer being played', () => {
    const state = applyEvents(newGame(), [
      { type: 'deck-chosen', seat: 1, deck },
      { type: 'deck-chosen', seat: 1, deck: { ...deck, name: 'Other' } },
      { type: 'deck-analyzed', seat: 1, deckName: 'Atraxa', analysis: clean },
    ]);
    expect(state.seats[1]!.deckAnalysis).toBeNull();
  });

  it('forgets the old check when another deck is chosen', () => {
    const state = applyEvents(newGame(), [
      { type: 'deck-chosen', seat: 1, deck },
      { type: 'deck-analyzed', seat: 1, deckName: 'Atraxa', analysis: clean },
      { type: 'deck-chosen', seat: 1, deck: { ...deck, name: 'Other' } },
    ]);
    expect(state.seats[1]!.deckAnalysis).toBeNull();
  });

  it('reads brackets and checks from the network carefully', () => {
    expect(toGameEvent({ type: 'bracket-declared', seat: 0, bracket: 6 })).toBeNull();
    expect(toGameEvent({ type: 'bracket-declared', seat: 0, bracket: null })).not.toBeNull();
    expect(toDeckAnalysis({ ...clean, gameChangers: [42] })).toBeNull();
    expect(toDeckAnalysis({ ...clean, complete: 'yes' })).toBeNull();
    expect(toDeckAnalysis(clean)).toEqual(clean);
  });
});
