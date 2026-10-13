import type { SeatIndex } from './table';

/**
 * Planechase and Archenemy: game variants with a deck of their own (planes, schemes) that the whole table
 * shares or watches.
 */

/** A card in a variant's deck, by its id in the card data. */
export interface VariantCard {
  readonly id: string;
  readonly name: string;
}

/** A scheme, and whether it stays in play after it's set in motion. */
export interface Scheme extends VariantCard {
  readonly ongoing: boolean;
}

export interface Planechase {
  /** The planar deck, in order; the current plane is at `index`. Planes walked away from go to the bottom. */
  readonly deck: readonly VariantCard[];
  readonly index: number;
  /** Times the planar die was rolled this turn: the first roll is free, each next one costs one more. */
  readonly rollsThisTurn: number;
}

export interface Archenemy {
  readonly seat: SeatIndex;
  /** The scheme deck, in order; the last one set in motion is at `index` (-1 before the first). */
  readonly deck: readonly Scheme[];
  readonly index: number;
  /** Ongoing schemes still in play, until abandoned. */
  readonly ongoing: readonly Scheme[];
}

export type PlanarDieResult = 'blank' | 'chaos' | 'planeswalk';

/** The planar die: one planeswalk side, one chaos side, four blank. */
export function rollPlanarDie(random: () => number): PlanarDieResult {
  const side = Math.floor(random() * 6);
  return side === 0 ? 'planeswalk' : side === 1 ? 'chaos' : 'blank';
}

export function currentPlane(planechase: Planechase): VariantCard | null {
  return planechase.deck[planechase.index] ?? null;
}

export function planeswalk(planechase: Planechase): Planechase {
  return { ...planechase, index: (planechase.index + 1) % planechase.deck.length };
}

export function currentScheme(archenemy: Archenemy): Scheme | null {
  return archenemy.deck[archenemy.index] ?? null;
}

/** Turns over the next scheme. An ongoing one stays in play. */
export function setSchemeInMotion(archenemy: Archenemy): Archenemy {
  const index = (archenemy.index + 1) % archenemy.deck.length;
  const scheme = archenemy.deck[index]!;
  const stays = scheme.ongoing && !archenemy.ongoing.some((s) => s.id === scheme.id);
  return { ...archenemy, index, ongoing: stays ? [...archenemy.ongoing, scheme] : archenemy.ongoing };
}

export const MAX_VARIANT_DECK = 400;

/** Reads untrusted data as a variant deck: 1 to MAX_VARIANT_DECK cards. Null if it isn't one. */
export function toVariantDeck(raw: unknown): VariantCard[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_VARIANT_DECK) return null;
  const cards: VariantCard[] = [];
  for (const item of raw) {
    const card = toVariantCard(item);
    if (!card) return null;
    cards.push(card);
  }
  return cards;
}

export function toSchemeDeck(raw: unknown): Scheme[] | null {
  const cards = toVariantDeck(raw);
  if (!cards || !(raw as unknown[]).every((item) => typeof (item as { ongoing?: unknown }).ongoing === 'boolean')) {
    return null;
  }
  return cards.map((card, i) => ({ ...card, ongoing: (raw as { ongoing: boolean }[])[i]!.ongoing }));
}

function toVariantCard(raw: unknown): VariantCard | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { id, name } = raw as Record<string, unknown>;
  return typeof id === 'string' &&
    id.length > 0 &&
    id.length <= 64 &&
    typeof name === 'string' &&
    name.length > 0 &&
    name.length <= 160
    ? { id, name }
    : null;
}
