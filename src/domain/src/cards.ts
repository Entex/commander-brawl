/** A Magic card, as much of it as the table needs: what it's called, what it does, and what it looks like. */

export type CommanderLegality = 'legal' | 'not_legal' | 'banned';

export interface CardFace {
  readonly name: string;
  readonly manaCost: string;
  readonly typeLine: string;
  readonly oracleText: string;
  /** "3/3", "Loyalty 4", "Defense 5", or empty. */
  readonly stats: string;
  /** Where the picture of this face is, if it has its own (double-faced cards). Opaque to the domain. */
  readonly image: string | null;
}

export interface Card {
  /** Scryfall's oracle id: the same for every printing of the card. */
  readonly id: string;
  /** The full name, with " // " between faces for cards that have more than one. */
  readonly name: string;
  readonly layout: string;
  readonly manaCost: string;
  readonly typeLine: string;
  readonly oracleText: string;
  readonly stats: string;
  readonly colorIdentity: readonly string[];
  readonly manaValue: number;
  readonly commander: CommanderLegality;
  /** On Wizards' list of cards that push a deck into a higher bracket. */
  readonly gameChanger: boolean;
  /**
   * Picture of the front. Opaque to the domain; the UI knows where to load it from, in whatever size
   * it needs (the whole card, or just the artwork for small spaces like a seat's commander badge).
   */
  readonly image: string | null;
  /** Who painted the art in that picture, to credit when it's shown without the card's own frame. */
  readonly artist: string | null;
  /** Only for cards with more than one face. */
  readonly faces: readonly CardFace[];
}

export interface Ruling {
  readonly date: string;
  readonly text: string;
}

/**
 * Lowercase letters, digits and single spaces only, with accents removed:
 * "Lim-Dûl's Vault" becomes "lim duls vault", so players can type names the easy way.
 */
export function normalizeCardName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
