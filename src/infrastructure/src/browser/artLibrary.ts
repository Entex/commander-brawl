import { artOfArtCrop, type ArtLibrary, type ArtPrint } from '@commander-brawl/application';
import type { Card } from '@commander-brawl/domain';
import { cardImageUrl } from './scryfallImages';
import { imageToRgba } from './pixels';

/**
 * Prints of cards' artwork, from Scryfall's pictures of just the artwork (about 60 kB each). Kept for the
 * session; the browser keeps the pictures longer. A few downloads at a time, so a whole deck's worth
 * doesn't crowd out the video.
 */
export class ScryfallArtLibrary implements ArtLibrary {
  private readonly prints = new Map<string, Promise<ArtPrint | null>>();
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(
    private readonly options: {
      readonly concurrency?: number;
      /** Where a card's artwork picture is. Scryfall's by default. */
      readonly artUrl?: (card: Card) => string | null;
    } = {},
  ) {}

  print(card: Card): Promise<ArtPrint | null> {
    const known = this.prints.get(card.id);
    if (known) return known;
    const url = this.options.artUrl ? this.options.artUrl(card) : card.image && cardImageUrl(card.image, 'art_crop');
    if (!url) return Promise.resolve(null);
    const loading = this.load(url).catch(() => {
      // Not kept: next time it may work (back online).
      this.prints.delete(card.id);
      return null;
    });
    this.prints.set(card.id, loading);
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
