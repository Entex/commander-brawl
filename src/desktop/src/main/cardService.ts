import { CardIndex, type NameMatch } from '@commander-brawl/application';
import type { Card, Ruling } from '@commander-brawl/domain';
import { ScryfallCards } from '@commander-brawl/infrastructure/node';
import type { CardDataStatus, CardDetails } from '../shared/api';

export interface CardServiceOptions {
  readonly dir: string;
  readonly appVersion: string;
  /** Scryfall's API, or a stand-in for tests. */
  readonly apiUrl: string | undefined;
  readonly emit: (status: CardDataStatus) => void;
}

/** Scryfall asks apps not to download more often than this; the data changes about daily, cards much less. */
const REFRESH_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const RESULTS = 20;
const CLOSEST = 10;

/** Every card, kept on this computer and refreshed weekly, so searching is instant and works offline. */
export class CardService {
  private readonly scryfall: ScryfallCards;
  private index: CardIndex | null = null;
  private current: CardDataStatus = { state: 'missing' };
  private downloading: Promise<void> | null = null;

  constructor(private readonly options: CardServiceOptions) {
    this.scryfall = new ScryfallCards({ dir: options.dir, appVersion: options.appVersion, apiUrl: options.apiUrl });
  }

  /** Loads the saved cards, and downloads new ones in the background if there are none or they're old. */
  async start(): Promise<void> {
    const saved = await this.scryfall.loadSaved();
    if (saved) {
      this.index = new CardIndex(saved.cards);
      this.setStatus({ state: 'ready', count: this.index.size, updatedAt: saved.updatedAt });
    }
    if (!saved || Date.now() - saved.savedAt > REFRESH_AFTER_MS) void this.refresh();
  }

  status(): CardDataStatus {
    return this.current;
  }

  /** Downloads the latest cards. The old ones keep working until the new ones are in. */
  refresh(): Promise<void> {
    this.downloading ??= this.download().finally(() => {
      this.downloading = null;
    });
    return this.downloading;
  }

  search(query: string): Card[] {
    return this.index?.search(query, RESULTS) ?? [];
  }

  /** The cards with these names (as written in a deck list), null where there's no such card. */
  byNames(names: readonly string[]): (Card | null)[] {
    return names.map((name) => this.index?.byName(name) ?? null);
  }

  byIds(ids: readonly string[]): (Card | null)[] {
    return ids.map((id) => this.index?.get(id) ?? null);
  }

  /** The cards whose names best match text read off a card in a camera picture. */
  closest(texts: readonly string[]): NameMatch[] {
    return this.index?.closest(texts, CLOSEST) ?? [];
  }

  /** The card a deck list means by this name, or undefined. Null while there are no cards yet. */
  lookup(): ((name: string) => Card | undefined) | null {
    const index = this.index;
    return index ? (name) => index.byName(name) : null;
  }

  async details(id: string): Promise<CardDetails | null> {
    const card = this.index?.get(id);
    if (!card) return null;
    const rulings: Ruling[] = await this.scryfall.rulings(id);
    return { card, rulings };
  }

  private async download(): Promise<void> {
    let lastPercent = -1;
    this.setStatus({ state: 'downloading', progress: 0 });
    try {
      const saved = await this.scryfall.download((fraction) => {
        const percent = Math.floor(fraction * 100);
        if (percent !== lastPercent) {
          lastPercent = percent;
          this.setStatus({ state: 'downloading', progress: fraction });
        }
      });
      this.index = new CardIndex(saved.cards);
      this.setStatus({ state: 'ready', count: this.index.size, updatedAt: saved.updatedAt });
    } catch (error) {
      console.error('[cards] download failed', error);
      this.setStatus({
        state: 'error',
        message: (error as Error).message,
        count: this.index?.size ?? 0,
      });
    }
  }

  private setStatus(status: CardDataStatus): void {
    this.current = status;
    this.options.emit(status);
  }
}
