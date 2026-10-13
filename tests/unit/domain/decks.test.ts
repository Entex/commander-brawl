import { applyEvents, deckSize, newGame, toDeckList, toGameEvent, type DeckList } from '@commander-brawl/domain';
import { describe, expect, it } from 'vitest';

const deck: DeckList = {
  name: 'Atraxa Counters',
  commanders: [{ id: 'atraxa', name: "Atraxa, Praetors' Voice", count: 1 }],
  cards: [
    { id: 'sol-ring', name: 'Sol Ring', count: 1 },
    { id: 'forest', name: 'Forest', count: 98 },
  ],
};

describe('decks at the table', () => {
  it('counts commanders and cards', () => {
    expect(deckSize(deck)).toBe(100);
  });

  it("become the seat's deck, and their commanders the seat's commanders", () => {
    const state = applyEvents(newGame(), [{ type: 'deck-chosen', seat: 2, deck }]);
    expect(state.seats[2]!.deck).toEqual(deck);
    expect(state.seats[2]!.commanders).toEqual(["Atraxa, Praetors' Voice"]);
  });

  it('stay for the next game', () => {
    const state = applyEvents(newGame(), [
      { type: 'deck-chosen', seat: 0, deck },
      { type: 'new-game', startingLife: 40 },
    ]);
    expect(state.seats[0]!.deck?.name).toBe('Atraxa Counters');
  });

  it('can be put away, keeping the commander names', () => {
    const state = applyEvents(newGame(), [
      { type: 'deck-chosen', seat: 0, deck },
      { type: 'deck-chosen', seat: 0, deck: null },
    ]);
    expect(state.seats[0]!.deck).toBeNull();
    expect(state.seats[0]!.commanders).toEqual(["Atraxa, Praetors' Voice"]);
  });
});

describe('reading decks from the network', () => {
  it('accepts a valid deck and drops extra fields', () => {
    expect(toDeckList({ ...deck, id: 'saved', secret: true })).toEqual(deck);
    expect(toGameEvent({ type: 'deck-chosen', seat: 0, deck })).toEqual({ type: 'deck-chosen', seat: 0, deck });
  });

  it.each([
    ['no name', { ...deck, name: ' ' }],
    ['three commanders', { ...deck, commanders: [deck.commanders[0], deck.commanders[0], deck.commanders[0]] }],
    ['a count of zero', { ...deck, cards: [{ id: 'x', name: 'X', count: 0 }] }],
    ['a card without an id', { ...deck, cards: [{ name: 'X', count: 1 }] }],
  ])('rejects a deck with %s', (_case, raw) => {
    expect(toDeckList(raw)).toBeNull();
  });
});
