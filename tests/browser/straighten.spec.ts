import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('http://localhost:5180/');
});

test('straightens a camera picture on the graphics card, frame by frame', async ({ page }) => {
  // The whole picture, as it is: each color stays in its corner, at the size asked for.
  const same = await page.evaluate(() =>
    window.harness.straightenTestPicture([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ]),
  );
  expect([same.width, same.height]).toEqual([320, 180]);
  expect(same.colors).toEqual(['r', 'b', 'g', 'rg']);

  // Corners given the other way round mirror it.
  const mirrored = await page.evaluate(() =>
    window.harness.straightenTestPicture([
      { x: 1, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ]),
  );
  expect(mirrored.colors).toEqual(['b', 'r', 'rg', 'g']);

  // A slanted shape in the middle comes out as the middle, straight.
  const slanted = await page.evaluate(() =>
    window.harness.straightenTestPicture([
      { x: 0.3, y: 0.2 },
      { x: 0.7, y: 0.25 },
      { x: 0.8, y: 0.8 },
      { x: 0.2, y: 0.75 },
    ]),
  );
  expect(slanted.colors).toEqual(['r', 'b', 'g', 'rg']);
});
