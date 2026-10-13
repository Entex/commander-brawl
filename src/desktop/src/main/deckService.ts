import { parseDeckText, resolveDeck, type ImportedDeck } from '@commander-brawl/application';
import { toDeckList, type DeckList } from '@commander-brawl/domain';
import { fetchDeck, isDeckLink, randomId, type DeckSitesOptions } from '@commander-brawl/infrastructure/node';
import { readFile, rename, writeFile } from 'node:fs/promises';
import type { SavedDeck } from '../shared/api';
import type { CardService } from './cardService';

export interface DeckServiceOptions {
  /** Where the saved decks live. */
  readonly file: string;
  readonly cards: CardService;
  readonly sites: DeckSitesOptions;
}

/** Decks the player imported, kept on this computer. */
export class DeckService {
  private decks: SavedDeck[] | null = null;

  constructor(private readonly options: DeckServiceOptions) {}

  async list(): Promise<readonly SavedDeck[]> {
    return this.load();
  }

  /** Reads a deck from a Moxfield or Archidekt link, or from a pasted list, and matches it to cards. */
  async import(source: string): Promise<ImportedDeck> {
    const lookup = this.options.cards.lookup();
    if (!lookup) throw new Error('The cards are still downloading. Try again in a moment.');
    const raw = isDeckLink(source) ? await fetchDeck(source, this.options.sites) : parseDeckText(source);
    const imported = resolveDeck(raw, lookup, 'Imported deck');
    if (imported.deck.commanders.length === 0 && imported.deck.cards.length === 0) {
      throw new Error('That doesn\'t look like a deck list. Put one card per line, like "1 Sol Ring".');
    }
    return imported;
  }

  /** Saves a new deck, or replaces the one with the same id. */
  async save(raw: unknown, id: string | null): Promise<SavedDeck> {
    const deck = toDeckList(raw);
    if (!deck) throw new Error('That deck has something wrong with it.');
    const decks = await this.load();
    const saved: SavedDeck = { ...deck, id: id ?? randomId(), savedAt: Date.now() };
    this.decks = [saved, ...decks.filter((d) => d.id !== saved.id)];
    await this.write();
    return saved;
  }

  async remove(id: string): Promise<void> {
    this.decks = (await this.load()).filter((d) => d.id !== id);
    await this.write();
  }

  private async load(): Promise<SavedDeck[]> {
    if (this.decks) return this.decks;
    try {
      const raw: unknown = JSON.parse(await readFile(this.options.file, 'utf8'));
      this.decks = Array.isArray(raw) ? raw.flatMap(toSavedDeck) : [];
    } catch {
      this.decks = [];
    }
    return this.decks;
  }

  private async write(): Promise<void> {
    await writeFile(`${this.options.file}.tmp`, JSON.stringify(this.decks ?? []));
    await rename(`${this.options.file}.tmp`, this.options.file);
  }
}

function toSavedDeck(raw: unknown): SavedDeck[] {
  const deck: DeckList | null = toDeckList(raw);
  const { id, savedAt } = (raw ?? {}) as { id?: unknown; savedAt?: unknown };
  return deck && typeof id === 'string' && typeof savedAt === 'number' ? [{ ...deck, id, savedAt }] : [];
}
