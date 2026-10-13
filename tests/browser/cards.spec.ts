import { expect, test } from '@playwright/test';
import { RHYSTIC_STUDY, drawCardPicture } from '../support/cardPicture';

test('reads the name off a card in a camera picture and says which card it is', async ({ page }) => {
  await page.goto('http://localhost:5180/');
  for (const [cardWidth, angle] of [
    [300, 0],
    [240, -8],
    [260, 90],
  ] as const) {
    // A close-up from a webcam: the card and some of the table around it.
    const picture = await page.evaluate(drawCardPicture, {
      width: 400,
      height: 560,
      cardWidth,
      angle,
      ...RHYSTIC_STUDY,
    });

    const result = await page.evaluate((p) => window.harness.identifyCard(p), picture);

    expect(result.found, `${cardWidth}px at ${angle}°`).toBe(true);
    expect(result.guesses[0], `${cardWidth}px at ${angle}°`).toMatchObject({ name: 'Rhystic Study' });
    expect(result.guesses[0]!.score).toBeGreaterThan(0.6);
  }
});
