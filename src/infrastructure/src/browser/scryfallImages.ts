/** Where Scryfall serves card pictures and mana symbols. */

export type CardImageSize = 'small' | 'normal' | 'large' | 'art_crop';

/** A card's picture in the given size, from the image reference stored with the card. */
export function cardImageUrl(image: string, size: CardImageSize): string {
  return `https://cards.scryfall.io/${size}/${image}`;
}

/** A mana or other symbol like {U}, {2/W} or {T}, as Scryfall's picture of it. */
export function symbolUrl(symbol: string): string {
  const code = symbol.replace(/[{}/]/g, '').toUpperCase();
  return `https://svgs.scryfall.io/card-symbols/${encodeURIComponent(code)}.svg`;
}
