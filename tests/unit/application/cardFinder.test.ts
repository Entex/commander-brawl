import {
  artOfArtCrop,
  artOfCard,
  artSimilarity,
  cardCorners,
  dominantTilt,
  extract,
  findCard,
  locationOfCorners,
  toGray,
} from '@commander-brawl/application';
import { describe, expect, it } from 'vitest';
import { addNoise, artwork, blank, drawCard, fillRect, type Picture } from '../../support/drawing';

const TABLE = [52, 70, 58] as const;

/** A card at the middle of a table picture, with part of the next card in view, like a camera close-up. */
function closeUp(angle: number, options: { width?: number; seed?: number } = {}): Picture {
  const picture = blank(320, 440, TABLE);
  const width = options.width ?? 190;
  drawCard(picture, { cx: -width * 0.28, cy: 230, width, angle: 0, art: artwork(99) });
  drawCard(picture, { cx: 160, cy: 220, width, angle, art: artwork(options.seed ?? 1) });
  addNoise(picture, 12);
  return picture;
}

describe('finding a card in a picture', () => {
  it('measures how much straight lines are tilted', () => {
    for (const angle of [0, 4, -9, 17, 33]) {
      const picture = blank(300, 300, [30, 30, 30]);
      fillRect(picture, { cx: 150, cy: 150, width: 120, height: 170, angle }, [220, 220, 220]);
      const tilt = dominantTilt(toGray(picture));
      expect(Math.abs(tilt - angle), `${angle}°: ${tilt.toFixed(2)}°`).toBeLessThan(1);
    }
  });

  it('finds an upright card, a tilted one, and a tapped one', () => {
    for (const angle of [0, 7, -15, 90]) {
      const found = findCard(closeUp(angle));
      expect(found, `${angle}°`).not.toBeNull();
      const { rect, sideways, clarity } = found!;
      expect(sideways, `${angle}°`).toBe(angle === 90);
      expect(clarity, `${angle}°`).toBeGreaterThan(1);
      // Straightening turns the picture back by the card's tilt (a quarter turn makes no difference).
      expect(Math.abs(((found!.angle + angle + 45) % 90) - 45), `${angle}°`).toBeLessThan(1.5);
      // The card's outline, or just inside its black border.
      const [long, short] = sideways ? [rect.width, rect.height] : [rect.height, rect.width];
      expect(short / 190, `${angle}°`).toBeGreaterThan(0.88);
      expect(short / 190, `${angle}°`).toBeLessThan(1.04);
      expect(long / short, `${angle}°`).toBeCloseTo(88 / 63, 0);
    }
  });

  it('looks only for a card lying the way it was asked for', () => {
    const upright = findCard(closeUp(0), { sideways: false });
    expect(upright?.sideways).toBe(false);
    const tapped = findCard(closeUp(90), { sideways: false });
    // A tapped card isn't an upright one; whatever upright rectangle it settles on isn't the card.
    expect(tapped === null || !tapped.sideways).toBe(true);
    expect(findCard(closeUp(90), { sideways: true })?.sideways).toBe(true);
  });

  it("turns a card's corners back into where it is", () => {
    for (const angle of [0, 7, -15, 90]) {
      const picture = closeUp(angle);
      const found = findCard(picture)!;
      const corners = cardCorners(found, picture.width, picture.height);
      const again = locationOfCorners(corners, picture.width, picture.height, found.clarity);
      expect(again.angle, `${angle}°`).toBeCloseTo(found.angle, 5);
      expect(again.sideways, `${angle}°`).toBe(found.sideways);
      for (const side of ['x', 'y', 'width', 'height'] as const) {
        expect(again.rect[side], `${angle}° ${side}`).toBeCloseTo(found.rect[side], 3);
      }
    }
  });

  it("doesn't make up a card where there is none", () => {
    const table = blank(320, 440, TABLE);
    addNoise(table, 30);
    const found = findCard(table);
    expect(found === null || found.clarity < 0.9).toBe(true);
  });

  it('cuts the card out straight, any way up', () => {
    const picture = closeUp(12);
    const found = findCard(picture)!;
    const card = extract(picture, found.angle, found.rect, 63, 88);
    const flipped = extract(picture, found.angle, found.rect, 63, 88, 2);
    // Top left inside the border is the frame; the same pixel upside down is the bottom right.
    expect([card.width, card.height]).toEqual([63, 88]);
    const pixel = (image: typeof card, x: number, y: number) => [
      ...image.data.subarray((y * 63 + x) * 4, (y * 63 + x) * 4 + 3),
    ];
    expect(pixel(card, 31, 20)).toEqual(pixel(flipped, 31, 67));
  });
});

describe('comparing artwork', () => {
  it('tells the same artwork from different artwork, through camera noise and a color cast', () => {
    const art = (seed: number, tint = 1) => {
      const crop = blank(160, 117, [0, 0, 0]);
      fillRect(crop, { cx: 80, cy: 58.5, width: 160, height: 117, angle: 0 }, (u, v) => {
        const [r, g, b] = artwork(seed)(u, v);
        return [r * tint, g, b * (2 - tint)];
      });
      return artOfArtCrop(crop);
    };
    const picture = closeUp(5, { seed: 3 });
    const found = findCard(picture)!;
    const seen = artOfCard(extract(picture, found.angle, found.rect, 252, 352));

    const same = artSimilarity(seen, art(3));
    expect(same).toBeGreaterThan(0.8);
    expect(artSimilarity(seen, art(3, 1.2))).toBeGreaterThan(0.7);
    // Unrelated artwork can look a bit alike (dark backgrounds, say), but clearly less.
    for (const other of [4, 5, 6, 7]) expect(artSimilarity(seen, art(other))).toBeLessThan(same - 0.25);
  });
});
