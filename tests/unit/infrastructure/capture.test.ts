import { crop, type RgbaImage } from '@commander-brawl/application';
import { likeness, photoTurns, videoToPhoto, widen } from '@commander-brawl/infrastructure/browser';
import { describe, expect, it } from 'vitest';
import { addNoise, artwork, blank, drawCard, fillRect } from '../../support/drawing';

describe('mapping a part of the video onto a full photo', () => {
  it('uses the middle band of a taller photo (4:3 photo, 16:9 video)', () => {
    const mapped = videoToPhoto({ x: 0, y: 0, width: 1, height: 1 }, 4 / 3, 16 / 9);
    expect(mapped.x).toBe(0);
    expect(mapped.width).toBe(1);
    expect(mapped.y).toBeCloseTo(0.125);
    expect(mapped.height).toBeCloseTo(0.75);
  });

  it('uses the middle of a wider photo', () => {
    const mapped = videoToPhoto({ x: 0.5, y: 0, width: 0.5, height: 1 }, 16 / 9, 4 / 3);
    expect(mapped.x).toBeCloseTo(0.5);
    expect(mapped.width).toBeCloseTo(0.375);
  });

  it('adds a margin without leaving the picture', () => {
    expect(widen({ x: 0.1, y: 0.5, width: 0.2, height: 0.4 }, 0.5)).toEqual({ x: 0, y: 0.3, width: 0.4, height: 0.7 });
  });
});

/** The picture turned clockwise this many quarters. */
function turn(image: RgbaImage, turns: number): RgbaImage {
  let current = image;
  for (let t = 0; t < turns; t++) {
    const { width, height, data } = current;
    const out = new Uint8ClampedArray(data.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // (x, y) goes to (height - 1 - y, x) in a picture `height` wide.
        const to = (x * height + (height - 1 - y)) * 4;
        out.set(data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4), to);
      }
    }
    current = { width: height, height: width, data: out };
  }
  return current;
}

/** A table as a phone sees it: the photo (4:3) covers a little more than the video (16:9). */
function tableView(noise: number) {
  const table = blank(240, 180, [40, 58, 50]);
  drawCard(table, { cx: 80, cy: 90, width: 50, angle: 5, art: artwork(1) });
  drawCard(table, { cx: 170, cy: 100, width: 50, angle: 90, art: artwork(2) });
  fillRect(table, { cx: 200, cy: 40, width: 60, height: 20, angle: 0 }, [220, 200, 160]);
  addNoise(table, 8, noise);
  return table;
}

describe('turning a phone photo the way up its video is', () => {
  const table = tableView(1);
  const video = crop(table, { x: 0, y: 22, width: 240, height: 135 });

  it.each([0, 1, 2, 3])('turns back a photo taken %i quarter turns off', (off) => {
    const { turns, likeness } = photoTurns(video, turn(table, off));
    expect(turns).toBe((4 - off) % 4);
    expect(likeness).toBeGreaterThan(0.7);
  });

  it("finds a black photo, or one of something else, unlike the video whichever way it's turned", () => {
    expect(photoTurns(video, blank(240, 180, [0, 0, 0])).likeness).toBeLessThan(0.7);
    const elsewhere = blank(240, 180, [40, 58, 50]);
    drawCard(elsewhere, { cx: 190, cy: 120, width: 70, angle: 30, art: artwork(3) });
    expect(photoTurns(video, elsewhere).likeness).toBeLessThan(0.7);
  });
});

describe("checking a phone's picture against its video", () => {
  const seen = crop(tableView(1), { x: 40, y: 20, width: 90, height: 130 });

  it('finds a picture of the same part alike, whatever its grain', () => {
    expect(likeness(crop(tableView(7), { x: 40, y: 20, width: 90, height: 130 }), seen)).toBeGreaterThan(0.8);
  });

  it('finds a turned picture of another part unlike', () => {
    const wrong = crop(turn(tableView(7), 1), { x: 0, y: 0, width: 90, height: 130 });
    expect(likeness(wrong, seen)).toBeLessThan(0.5);
  });
});
