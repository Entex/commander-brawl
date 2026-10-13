import { expect, test } from '@playwright/test';

test('records the last seconds of the table and saves them as a video that plays', async ({ page }) => {
  await page.goto('http://localhost:5180/');
  // Five seconds recorded, the last two kept (from the key frame before them).
  const clip = await page.evaluate(() => window.harness.recordClip(5_000, 2));

  expect(clip.head).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
  expect([clip.width, clip.height]).toEqual([320, 180]);
  expect(clip.duration).toBeGreaterThanOrEqual(1.8);
  expect(clip.duration).toBeLessThanOrEqual(4.2);
  expect(clip.played).toBe(true);
});
