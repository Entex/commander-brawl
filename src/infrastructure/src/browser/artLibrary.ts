import { artOfArtCrop, type ArtLibrary, type ArtPrint } from '@commander-brawl/application';
import type { Card } from '@commander-brawl/domain';
import { cardImageUrl } from './scryfallImages';
import { imageToRgba } from './pixels';

/**
 * Prints of cards' artwork, from Scryfall's pictures of just the artwork (about 60 kB each). Kept for the
 * session; the browser keeps the pictures longer. A few downloads at a time, so a whole deck's worth
 * doesn't crowd out the video.
 */
/** Other artworks of one card compared, at most. */
const MAX_ALTERNATIVES = 12;

export class ScryfallArtLibrary implements ArtLibrary {
  /** By the picture's path: a card's usual one, or the printing a deck has. */
  private readonly prints = new Map<string, Promise<ArtPrint | null>>();
  /** What players said was this card in earlier close-ups, by card. */
  private readonly remembered = new Map<string, ArtPrint[]>();
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(
    private readonly options: {
      readonly concurrency?: number;
      /** Where a card's artwork picture is. Scryfall's by default. */
      readonly artUrl?: (card: Card) => string | null;
      /** The pictures (as Card.image is) of all of a card's artworks: its other printings. */
      readonly artworks?: (card: Card) => Promise<readonly string[]>;
    } = {},
  ) {}

  print(card: Card): Promise<ArtPrint | null> {
    const url = this.options.artUrl ? this.options.artUrl(card) : card.image && cardImageUrl(card.image, 'art_crop');
    return url ? this.printAt(url) : Promise.resolve(null);
  }

  /** The card's other artwork: what players said was it before, then its other printings. */
  async alternatives(card: Card): Promise<readonly ArtPrint[]> {
    const images = this.options.artworks ? await this.options.artworks(card).catch(() => []) : [];
    // The newest few: a card printed many times (Sol Ring) would otherwise be dozens of downloads for one close-up.
    const others = images
      .filter((image) => image !== card.image)
      .slice(0, MAX_ALTERNATIVES)
      .map((image) => cardImageUrl(image, 'art_crop'));
    const prints = await Promise.all(others.map((url) => this.printAt(url)));
    return [...(this.remembered.get(card.id) ?? []), ...prints.filter((p): p is ArtPrint => p !== null)];
  }

  /** A player said a close-up of this artwork was this card: from now on it counts as one of the card's artworks. */
  remember(cardId: string, print: ArtPrint): void {
    this.remembered.set(cardId, [...(this.remembered.get(cardId) ?? []).slice(-4), print]);
  }

  private printAt(url: string): Promise<ArtPrint | null> {
    const known = this.prints.get(url);
    if (known) return known;
    const loading = this.load(url).catch(() => {
      // Not kept: next time it may work (back online).
      this.prints.delete(url);
      return null;
    });
    this.prints.set(url, loading);
    return loading;
  }

  private async load(url: string): Promise<ArtPrint> {
    await this.slot();
    try {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.src = url;
      await image.decode();
      return artOfArtCrop(imageToRgba(image));
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }

  private async slot(): Promise<void> {
    if (this.active >= (this.options.concurrency ?? 6)) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.active++;
  }
}
