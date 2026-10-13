/** Partners and backgrounds give a player two commanders. */
export const MAX_COMMANDERS = 2;

/** A card in a deck: which card (by id), its name for display, and how many. */
export interface DeckCard {
  readonly id: string;
  readonly name: string;
  readonly count: number;
}

export interface DeckList {
  readonly name: string;
  /** One, or two for partners and backgrounds. Empty until the player says which. */
  readonly commanders: readonly DeckCard[];
  /** The rest of the deck. */
  readonly cards: readonly DeckCard[];
}

export const MAX_DECK_NAME_LENGTH = 60;
/** Generous for Commander (100 cards), but keeps a deck small enough to share with the table. */
export const MAX_DECK_ENTRIES = 250;

/** All the cards, commanders included. 100 for a legal Commander deck. */
export function deckSize(deck: DeckList): number {
  return [...deck.commanders, ...deck.cards].reduce((total, card) => total + card.count, 0);
}

/** Reads untrusted data as a deck list. Returns null if it isn't a valid one. */
export function toDeckList(raw: unknown): DeckList | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { name, commanders, cards } = raw as Record<string, unknown>;
  if (typeof name !== 'string' || name.trim().length === 0 || name.length > MAX_DECK_NAME_LENGTH) return null;
  if (!Array.isArray(commanders) || commanders.length > MAX_COMMANDERS || !commanders.every(isDeckCard)) return null;
  if (!Array.isArray(cards) || cards.length > MAX_DECK_ENTRIES || !cards.every(isDeckCard)) return null;
  const pick = (c: DeckCard): DeckCard => ({ id: c.id, name: c.name, count: c.count });
  return { name: name.trim(), commanders: commanders.map(pick), cards: cards.map(pick) };
}

function isDeckCard(value: unknown): value is DeckCard {
  if (typeof value !== 'object' || value === null) return false;
  const { id, name, count } = value as Record<string, unknown>;
  return (
    typeof id === 'string' &&
    id.length > 0 &&
    id.length <= 64 &&
    typeof name === 'string' &&
    name.length > 0 &&
    name.length <= 160 &&
    typeof count === 'number' &&
    Number.isInteger(count) &&
    count >= 1 &&
    count <= 99
  );
}
