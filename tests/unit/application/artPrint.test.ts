import { artOfArtCrop, artOfCard, artSimilarity, artsOfCard, type ArtPrint } from '@commander-brawl/application';
import { describe, expect, it } from 'vitest';
import { addNoise, artwork, blank, drawCard, fillRect } from '../../support/drawing';

/** Scryfall's picture of just the artwork, drawn the same as on the cards. */
function officialArt(seed: number): ArtPrint {
  const crop = blank(160, 117, [0, 0, 0]);
  fillRect(crop, { cx: 80, cy: 58.5, width: 160, height: 117, angle: 0 }, artwork(seed));
  return artOfArtCrop(crop);
}

/**
 * A straightened close-up whose outline was a little off, as around a sleeve: the card smaller in it than it should
 * be, and lower.
 */
function offCard(seed: number) {
  const view = blank(480, 670, [150, 30, 30]);
  drawCard(view, { cx: 240, cy: 335 + 670 * 0.05, width: 480 * 0.9, angle: 0, art: artwork(seed) });
  addNoise(view, 8);
  return view;
}

describe("comparing a card's artwork", () => {
  it('still finds it in a close-up whose outline is a little off, as around a sleeve', () => {
    const arts = Array.from({ length: 12 }, (_, i) => officialArt(i + 1));
    for (const seed of [2, 5, 9]) {
      const view = offCard(seed);
      const looked = artsOfCard(view);
      const best = arts.map((art) => Math.max(...looked.map((print) => artSimilarity(print, art))));
      // Its own artwork, clearly: enough to settle which card it is (see ART_DECIDES in cardIdentification).
      expect(best.indexOf(Math.max(...best)), `art ${seed}`).toBe(seed - 1);
      expect(best[seed - 1], `art ${seed}`).toBeGreaterThan(0.75);
      // Looked at only where it should be, it's less clear.
      expect(artSimilarity(artOfCard(view), arts[seed - 1]!), `art ${seed}`).toBeLessThan(best[seed - 1]!);
    }
  });
});
