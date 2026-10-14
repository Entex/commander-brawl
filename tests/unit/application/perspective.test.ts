import {
  PLAYMAT_RATIO,
  applyHomography,
  cropInCamera,
  orderCorners,
  shrunkSize,
  squareToQuad,
  straightenedSize,
  warpCrop,
  type Quad,
} from '@commander-brawl/application';
import { describe, expect, it } from 'vitest';
import { blank, fillRect } from '../../support/drawing';

// A playmat seen from its long side at an angle: the far edge looks shorter.
const mat: Quad = [
  { x: 0.3, y: 0.2 },
  { x: 0.7, y: 0.2 },
  { x: 0.9, y: 0.8 },
  { x: 0.1, y: 0.8 },
];

describe('straightening a picture taken at an angle', () => {
  it('takes the square to the corners, and the middle of the square inside them', () => {
    const h = squareToQuad(mat);
    for (const [i, corner] of [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ].entries()) {
      const at = applyHomography(h, corner);
      expect(at.x).toBeCloseTo(mat[i]!.x);
      expect(at.y).toBeCloseTo(mat[i]!.y);
    }
    // The middle of the mat is nearer the far edge in the picture than halfway: perspective.
    const middle = applyHomography(h, { x: 0.5, y: 0.5 });
    expect(middle.x).toBeCloseTo(0.5);
    expect(middle.y).toBeLessThan(0.5);
  });

  it('puts the corners in order, however they were tapped', () => {
    expect(orderCorners([mat[2], mat[0], mat[3], mat[1]])).toEqual(mat);
    expect(() => orderCorners([mat[0], mat[1]])).toThrow();
  });

  it("makes the straight picture a playmat's shape, no wider than the camera", () => {
    expect(straightenedSize(mat, 1920, 1080)).toEqual({ width: 1852, height: 1080 });
    const upright: Quad = [
      { x: 0.4, y: 0.05 },
      { x: 0.6, y: 0.05 },
      { x: 0.65, y: 0.95 },
      { x: 0.35, y: 0.95 },
    ];
    const size = straightenedSize(upright, 1920, 1080);
    expect(size.width / size.height).toBeCloseTo(1 / PLAYMAT_RATIO, 1);

    // A 4K camera: no longer than 1080p's width either way, for the others.
    expect(straightenedSize(mat, 3840, 2160)).toEqual({ width: 1920, height: 1120 });
    expect(straightenedSize(upright, 3840, 2160)).toEqual({ width: 1120, height: 1920 });
  });

  it('shrinks a picture larger than the others get, keeping its shape, and never grows one', () => {
    expect(shrunkSize(3840, 2160)).toEqual({ width: 1920, height: 1080 });
    expect(shrunkSize(2160, 3840)).toEqual({ width: 1080, height: 1920 });
    expect(shrunkSize(1280, 720)).toEqual({ width: 1280, height: 720 });
  });

  it('finds the part of the camera picture behind a crop, and straightens it', () => {
    // A camera picture: the mat's top half red, bottom half blue (as the camera sees it).
    const h = squareToQuad(mat);
    const picture = blank(400, 300, [0, 0, 0]);
    const middle = applyHomography(h, { x: 0.5, y: 0.5 });
    fillRect(picture, { cx: 200, cy: (middle.y * 300) / 2, width: 400, height: middle.y * 300, angle: 0 }, [255, 0, 0]);
    fillRect(
      picture,
      { cx: 200, cy: (middle.y * 300 + 300) / 2, width: 400, height: 300 - middle.y * 300, angle: 0 },
      [0, 0, 255],
    );

    const crop = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };
    const region = cropInCamera(crop, h);
    expect(region.y).toBeGreaterThan(0.2);
    expect(region.y + region.height).toBeLessThan(0.8);
    const part = cropOf(picture, region);
    const straight = warpCrop(part, region, crop, h, 40, 40);
    // The straight crop's top half is red and its bottom half blue: the mat's middle line is straight across.
    const at = (x: number, y: number) => [...straight.data.subarray((y * 40 + x) * 4, (y * 40 + x) * 4 + 3)];
    expect(at(20, 8)).toEqual([255, 0, 0]);
    expect(at(20, 32)).toEqual([0, 0, 255]);
  });
});

function cropOf(image: ReturnType<typeof blank>, region: { x: number; y: number; width: number; height: number }) {
  const x0 = Math.round(region.x * image.width);
  const y0 = Math.round(region.y * image.height);
  const width = Math.round(region.width * image.width);
  const height = Math.round(region.height * image.height);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    data.set(
      image.data.subarray(((y0 + y) * image.width + x0) * 4, ((y0 + y) * image.width + x0 + width) * 4),
      y * width * 4,
    );
  }
  return { width, height, data };
}
