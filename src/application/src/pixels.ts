/** Plain pixel images, for working out what's in a camera picture. Same layout as the browser's ImageData. */

export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  /** Red, green, blue and alpha for each pixel, row by row. */
  readonly data: Uint8ClampedArray;
}

/** Brightness only, 0 to 255, row by row. */
export interface GrayImage {
  readonly width: number;
  readonly height: number;
  readonly data: Float32Array;
}

/** A rectangle in pixels. */
export interface PixelRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Brightness, shrunk (by averaging) so the longer side is at most maxSide. */
export function toGray(image: RgbaImage, maxSide = Infinity): GrayImage {
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const sums = new Float32Array(width * height);
  const counts = new Float32Array(width * height);
  const { data } = image;
  for (let y = 0; y < image.height; y++) {
    const row = Math.min(height - 1, Math.floor(y * scale)) * width;
    for (let x = 0; x < image.width; x++) {
      const i = (y * image.width + x) * 4;
      const target = row + Math.min(width - 1, Math.floor(x * scale));
      sums[target]! += 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
      counts[target]! += 1;
    }
  }
  for (let i = 0; i < sums.length; i++) sums[i] = counts[i]! > 0 ? sums[i]! / counts[i]! : 0;
  return { width, height, data: sums };
}

/**
 * A rectangle of the picture turned by `angle` degrees (clockwise) around the picture's center, sampled
 * into a new picture of the given size. `rect` is in the turned picture's coordinates. With `quarterTurns`,
 * the result is additionally turned a quarter clockwise that many times (tapped and upside-down cards).
 */
export function extract(
  image: RgbaImage,
  angle: number,
  rect: PixelRect,
  width: number,
  height: number,
  quarterTurns = 0,
): RgbaImage {
  const turns = ((quarterTurns % 4) + 4) % 4;
  const out = new Uint8ClampedArray(width * height * 4);
  const radians = (angle * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const cx = image.width / 2;
  const cy = image.height / 2;
  // Size of the rectangle as it is in the turned picture, before the quarter turns.
  const sideways = turns % 2 === 1;
  const sourceWidth = sideways ? height : width;
  const sourceHeight = sideways ? width : height;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Undo the quarter turns: where this output pixel is in the unturned rectangle.
      let u: number;
      let v: number;
      if (turns === 0) [u, v] = [x, y];
      else if (turns === 1) [u, v] = [y, sourceHeight - 1 - x];
      else if (turns === 2) [u, v] = [sourceWidth - 1 - x, sourceHeight - 1 - y];
      else [u, v] = [sourceWidth - 1 - y, x];
      // Into the turned picture, then back into the original one.
      const tx = rect.x + ((u + 0.5) / sourceWidth) * rect.width - cx;
      const ty = rect.y + ((v + 0.5) / sourceHeight) * rect.height - cy;
      const sx = cos * tx + sin * ty + cx - 0.5;
      const sy = -sin * tx + cos * ty + cy - 0.5;
      sampleInto(image, sx, sy, out, (y * width + x) * 4);
    }
  }
  return { width, height, data: out };
}

/** Bilinear sample; transparent outside the picture. */
function sampleInto(image: RgbaImage, sx: number, sy: number, out: Uint8ClampedArray, o: number): void {
  if (sx < -0.5 || sy < -0.5 || sx > image.width - 0.5 || sy > image.height - 0.5) return;
  const x0 = Math.max(0, Math.min(image.width - 1, Math.floor(sx)));
  const y0 = Math.max(0, Math.min(image.height - 1, Math.floor(sy)));
  const x1 = Math.min(image.width - 1, x0 + 1);
  const y1 = Math.min(image.height - 1, y0 + 1);
  const fx = Math.max(0, Math.min(1, sx - x0));
  const fy = Math.max(0, Math.min(1, sy - y0));
  const { data, width } = image;
  for (let c = 0; c < 4; c++) {
    const top = data[(y0 * width + x0) * 4 + c]! * (1 - fx) + data[(y0 * width + x1) * 4 + c]! * fx;
    const bottom = data[(y1 * width + x0) * 4 + c]! * (1 - fx) + data[(y1 * width + x1) * 4 + c]! * fx;
    out[o + c] = top * (1 - fy) + bottom * fy;
  }
}

/** A part of the picture, as a new picture of the same resolution. */
export function crop(image: RgbaImage, rect: PixelRect): RgbaImage {
  const x0 = Math.max(0, Math.round(rect.x));
  const y0 = Math.max(0, Math.round(rect.y));
  const width = Math.max(1, Math.min(image.width - x0, Math.round(rect.width)));
  const height = Math.max(1, Math.min(image.height - y0, Math.round(rect.height)));
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const from = ((y0 + y) * image.width + x0) * 4;
    out.set(image.data.subarray(from, from + width * 4), y * width * 4);
  }
  return { width, height, data: out };
}
