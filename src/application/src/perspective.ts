import type { RgbaImage } from './pixels';
import type { CropRect } from './snapshots';

/**
 * Straightening a camera picture that looks at the table at an angle: the four corners of the playmat, as
 * seen by the camera, are stretched back into a rectangle.
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Four corners, in order: top left, top right, bottom right, bottom left. */
export type Quad = readonly [Point, Point, Point, Point];

/** A 3×3 matrix, row by row, mapping (x, y, 1) to (x', y', w): the point (x'/w, y'/w). */
export type Homography = readonly number[];

/** A standard playmat: 24 by 14 inches. */
export const PLAYMAT_RATIO = 24 / 14;

/** The homography that takes each of the four `from` points to the matching `to` point. */
export function homography(from: Quad, to: Quad): Homography {
  // Eight equations (two per point) for the eight unknowns, the last entry being 1.
  const rows: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i]!;
    const { x: u, y: v } = to[i]!;
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  return [...solve(rows), 1];
}

/** The homography that takes the unit square (0..1 both ways) to the quad. */
export function squareToQuad(quad: Quad): Homography {
  return homography(
    [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    quad,
  );
}

export function applyHomography(h: Homography, p: Point): Point {
  const w = h[6]! * p.x + h[7]! * p.y + h[8]!;
  return { x: (h[0]! * p.x + h[1]! * p.y + h[2]!) / w, y: (h[3]! * p.x + h[4]! * p.y + h[5]!) / w };
}

/**
 * Puts four points in order (top left, top right, bottom right, bottom left), whatever order they were
 * tapped in: around their middle, starting from the top left.
 */
export function orderCorners(points: readonly Point[]): Quad {
  if (points.length !== 4) throw new Error('A quad has four corners.');
  const cx = points.reduce((sum, p) => sum + p.x, 0) / 4;
  const cy = points.reduce((sum, p) => sum + p.y, 0) / 4;
  const sorted = [...points].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  // Clockwise on screen (y down) from the left: the top left is the one with the smallest x + y.
  const start = sorted.reduce((best, p, i) => (p.x + p.y < sorted[best]!.x + sorted[best]!.y ? i : best), 0);
  return [0, 1, 2, 3].map((k) => sorted[(start + k) % 4]!) as unknown as Quad;
}

/**
 * The size of the straightened picture: a playmat's shape (on its side or upright, as the corners suggest),
 * as wide as the camera picture at most.
 */
export function straightenedSize(
  quad: Quad,
  pictureWidth: number,
  pictureHeight: number,
  maxWidth = 1920,
): { width: number; height: number } {
  const length = (a: Point, b: Point) => Math.hypot((a.x - b.x) * pictureWidth, (a.y - b.y) * pictureHeight);
  const across = Math.max(length(quad[0], quad[1]), length(quad[3], quad[2]));
  const down = Math.max(length(quad[0], quad[3]), length(quad[1], quad[2]));
  const ratio = across >= down ? PLAYMAT_RATIO : 1 / PLAYMAT_RATIO;
  const width = Math.min(maxWidth, pictureWidth, Math.round(pictureHeight * ratio));
  return { width: even(width), height: even(width / ratio) };
}

/**
 * The part of the camera picture behind a crop of the straightened picture: the smallest rectangle around it
 * (fractions of the camera picture). With `squareToQuad(corners)` as `h`.
 */
export function cropInCamera(crop: CropRect, h: Homography): CropRect {
  const corners = [
    { x: crop.x, y: crop.y },
    { x: crop.x + crop.width, y: crop.y },
    { x: crop.x + crop.width, y: crop.y + crop.height },
    { x: crop.x, y: crop.y + crop.height },
  ].map((p) => applyHomography(h, p));
  const x0 = clamp(Math.min(...corners.map((p) => p.x)));
  const y0 = clamp(Math.min(...corners.map((p) => p.y)));
  const x1 = clamp(Math.max(...corners.map((p) => p.x)));
  const y1 = clamp(Math.max(...corners.map((p) => p.y)));
  return { x: x0, y: y0, width: Math.max(0.001, x1 - x0), height: Math.max(0.001, y1 - y0) };
}

/**
 * Straightens a picture of `region` of the camera picture (see cropInCamera) into the `crop` of the
 * straightened picture, at the given size.
 */
export function warpCrop(
  image: RgbaImage,
  region: CropRect,
  crop: CropRect,
  h: Homography,
  width: number,
  height: number,
): RgbaImage {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const camera = applyHomography(h, {
        x: crop.x + ((i + 0.5) / width) * crop.width,
        y: crop.y + ((j + 0.5) / height) * crop.height,
      });
      const sx = ((camera.x - region.x) / region.width) * image.width - 0.5;
      const sy = ((camera.y - region.y) / region.height) * image.height - 0.5;
      sample(image, sx, sy, out, (j * width + i) * 4);
    }
  }
  return { width, height, data: out };
}

function sample(image: RgbaImage, sx: number, sy: number, out: Uint8ClampedArray, o: number): void {
  if (sx < -0.5 || sy < -0.5 || sx > image.width - 0.5 || sy > image.height - 0.5) {
    out[o + 3] = 255;
    return;
  }
  const x0 = Math.max(0, Math.min(image.width - 1, Math.floor(sx)));
  const y0 = Math.max(0, Math.min(image.height - 1, Math.floor(sy)));
  const x1 = Math.min(image.width - 1, x0 + 1);
  const y1 = Math.min(image.height - 1, y0 + 1);
  const fx = Math.max(0, Math.min(1, sx - x0));
  const fy = Math.max(0, Math.min(1, sy - y0));
  for (let c = 0; c < 4; c++) {
    const top =
      image.data[(y0 * image.width + x0) * 4 + c]! * (1 - fx) + image.data[(y0 * image.width + x1) * 4 + c]! * fx;
    const bottom =
      image.data[(y1 * image.width + x0) * 4 + c]! * (1 - fx) + image.data[(y1 * image.width + x1) * 4 + c]! * fx;
    out[o + c] = top * (1 - fy) + bottom * fy;
  }
}

/** Solves the linear system given as rows of coefficients followed by the right-hand side. */
function solve(rows: number[][]): number[] {
  const n = rows.length;
  const m = rows.map((row) => [...row]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r]![col]!) > Math.abs(m[pivot]![col]!)) pivot = r;
    if (Math.abs(m[pivot]![col]!) < 1e-12) throw new Error('These corners don’t make a shape.');
    [m[col], m[pivot]] = [m[pivot]!, m[col]!];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = m[r]![col]! / m[col]![col]!;
      for (let c = col; c <= n; c++) m[r]![c]! -= factor * m[col]![c]!;
    }
  }
  return m.map((row, i) => row[n]! / row[i]!);
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function even(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}
