import type { Quad } from './perspective';
import { toGray, type GrayImage, type PixelRect, type RgbaImage } from './pixels';

/** Width to height of a Magic card (63 × 88 mm). */
export const CARD_RATIO = 63 / 88;

/** Where a card is in a picture. */
export interface CardLocation {
  /** Turning the picture this many degrees clockwise makes the card's edges straight. */
  readonly angle: number;
  /** The card in the turned picture, in pixels of the original picture. */
  readonly rect: PixelRect;
  /** Lying sideways: tapped, or the camera turned. */
  readonly sideways: boolean;
  /** How clearly the card's edges stand out from everything else, from 0. Above 1 is a good find. */
  readonly clarity: number;
}

export interface FindCardOptions {
  /** A point on the card, in pixels. Defaults to the middle of the picture. */
  readonly point?: { readonly x: number; readonly y: number };
  /** The smallest card to look for, as a share of the picture's shorter side. */
  readonly minSize?: number;
  /**
   * Tilts to try (see CardLocation.angle), keeping the clearest find. By default, the picture's own: the way
   * most of its lines run, which is the card's unless something else (a striped cloth) has more lines.
   */
  readonly angles?: readonly number[];
  /** Only a card lying this way: upright (false) or sideways (true). Either by default. */
  readonly sideways?: boolean;
}

/** The picture is shrunk to this before looking: enough for card edges, quick to search. */
const WORK_SIZE = 200;
/** How far from a perfect card shape (from the camera's angle, or a sleeve) a find may be. */
const SHAPE_TOLERANCES = [0.93, 1, 1.07];

/**
 * Finds the card at a point of a camera picture: its tilt, and the card-shaped rectangle whose four edges
 * stand out most. Null if nothing card-shaped stands out.
 */
export function findCard(image: RgbaImage, options: FindCardOptions = {}): CardLocation | null {
  const gray = toGray(image, WORK_SIZE);
  const scale = image.width / gray.width;
  const point = options.point
    ? { x: options.point.x / scale, y: options.point.y / scale }
    : { x: gray.width / 2, y: gray.height / 2 };
  let best: Rectangle | null = null;
  let angle = 0;
  for (const tried of options.angles ?? [-dominantTilt(gray)]) {
    const turnedPoint = turnPoint(point, tried, gray.width, gray.height);
    const ways = options.sideways === undefined ? [false, true] : [options.sideways];
    const found = bestRectangle(turnGray(gray, tried), turnedPoint, options.minSize ?? 0.2, ways);
    if (found && (!best || found.clarity > best.clarity)) [best, angle] = [found, tried];
  }
  if (!best) return null;
  return {
    angle,
    rect: {
      x: best.rect.x * scale,
      y: best.rect.y * scale,
      width: best.rect.width * scale,
      height: best.rect.height * scale,
    },
    sideways: best.rect.width > best.rect.height,
    clarity: best.clarity,
  };
}

/**
 * The four corners of a found card in the picture it was found in, in pixels: clockwise from the top left
 * of its rectangle in the turned picture (see CardLocation.rect).
 */
export function cardCorners(location: CardLocation, width: number, height: number): Quad {
  const { rect, angle } = location;
  const radians = (angle * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  // Out of the turned picture, the same way extract() samples it.
  const back = (x: number, y: number) => {
    const tx = x - width / 2;
    const ty = y - height / 2;
    return { x: cos * tx + sin * ty + width / 2, y: -sin * tx + cos * ty + height / 2 };
  };
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  return [back(rect.x, rect.y), back(right, rect.y), back(right, bottom), back(rect.x, bottom)];
}

/**
 * Where a card is, from its four corners in pixels, clockwise from its top left as it lies (as cardCorners
 * gives them). `clarity` is what it says about how sure that is.
 */
export function locationOfCorners(corners: Quad, width: number, height: number, clarity: number): CardLocation {
  const [first, second] = corners;
  // Its top edge's tilt, folded into a quarter turn either way (which side is the top doesn't matter here).
  const tilt = (Math.atan2(second.y - first.y, second.x - first.x) * 180) / Math.PI;
  const angle = -((((tilt % 90) + 90 + 45) % 90) - 45);
  const turned = corners.map((corner) => turnPoint(corner, angle, width, height));
  const xs = turned.map((p) => p.x);
  const ys = turned.map((p) => p.y);
  const rect = {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
  return { angle, rect, sideways: rect.width > rect.height, clarity };
}

/**
 * How much the picture's straight lines are tilted, in degrees between -45 and 45 (clockwise positive).
 * Card edges, frames and lines of text all run the same way, so the most common edge direction (folded
 * into a quarter turn) is the card's tilt.
 */
export function dominantTilt(gray: GrayImage): number {
  // Blurred first: on sharp, stair-stepped edges Sobel leans toward straight and diagonal directions.
  const { gx, gy } = sobel(blur(gray, 1.2));
  const magnitudes = new Float32Array(gx.length);
  for (let i = 0; i < gx.length; i++) magnitudes[i] = Math.hypot(gx[i]!, gy[i]!);
  // Only clear edges: the strongest fifth.
  const threshold = quantile(magnitudes, 0.8);
  const bins = 180;
  const histogram = new Float64Array(bins);
  for (let i = 0; i < gx.length; i++) {
    const magnitude = magnitudes[i]!;
    if (magnitude <= threshold || magnitude === 0) continue;
    const degrees = (Math.atan2(gy[i]!, gx[i]!) * 180) / Math.PI;
    const folded = (((degrees % 90) + 90 + 45) % 90) - 45;
    histogram[Math.min(bins - 1, Math.floor(((folded + 45) / 90) * bins))]! += magnitude;
  }
  const smooth = new Float64Array(bins);
  for (let i = 0; i < bins; i++) {
    for (let k = -3; k <= 3; k++) smooth[i]! += histogram[(i + k + bins) % bins]! * (4 - Math.abs(k));
  }
  let peak = 0;
  for (let i = 1; i < bins; i++) if (smooth[i]! > smooth[peak]!) peak = i;
  const coarse = ((peak + 0.5) / bins) * 90 - 45;
  // Refined: the average direction of the edges near the peak (in quarter-turn space, where 44° and -44°
  // are neighbors).
  let sumCos = 0;
  let sumSin = 0;
  for (let i = 0; i < gx.length; i++) {
    const magnitude = magnitudes[i]!;
    if (magnitude <= threshold || magnitude === 0) continue;
    const radians = Math.atan2(gy[i]!, gx[i]!) * 4;
    const degrees = (radians * 45) / Math.PI;
    const folded = ((((degrees - coarse) % 90) + 90 + 45) % 90) - 45;
    if (Math.abs(folded) > 4) continue;
    sumCos += Math.cos(radians) * magnitude;
    sumSin += Math.sin(radians) * magnitude;
  }
  const tilt = sumCos === 0 && sumSin === 0 ? coarse : (Math.atan2(sumSin, sumCos) * 45) / Math.PI;
  return Math.abs(tilt) < 0.25 ? 0 : tilt;
}

interface Rectangle {
  readonly rect: PixelRect;
  readonly clarity: number;
}

/**
 * The card-shaped rectangle around the point whose edges stand out most. Every size, shape (within
 * tolerance) and position is tried; running sums make each try a handful of lookups.
 */
function bestRectangle(
  gray: GrayImage,
  point: { x: number; y: number },
  minSize: number,
  ways: readonly boolean[],
): Rectangle | null {
  const { width, height } = gray;
  const { gx, gy, valid } = sobel(gray);
  // Vertical edges, summed down each column; horizontal edges, summed along each row. Spread by a pixel
  // so a slightly slanted edge still lines up.
  const columns = new Float64Array((width + 1) * (height + 1));
  const rows = new Float64Array((width + 1) * (height + 1));
  let total = 0;
  let count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const v = spread(gx, valid, width, x, y, 1, 0);
      const h = spread(gy, valid, width, x, y, 0, 1);
      // columns[x][y + 1] = sum of vertical edges in column x above row y + 1.
      columns[x * (height + 1) + y + 1] = columns[x * (height + 1) + y]! + v;
      rows[y * (width + 1) + x + 1] = rows[y * (width + 1) + x]! + h;
      if (valid[i]) {
        total += Math.abs(gx[i]!) + Math.abs(gy[i]!);
        count++;
      }
    }
  }
  const average = count > 0 ? total / count : 0;
  if (average === 0) return null;

  const shorter = Math.min(width, height);
  const minSide = Math.max(8, Math.round(shorter * minSize * CARD_RATIO));
  // Every rectangle that was nearly the best when it was tried.
  const near: Rectangle[] = [];
  let bestScore = 0;
  const px = Math.round(point.x);
  const py = Math.round(point.y);
  for (const sideways of ways) {
    // Most cards on a table are upright; a tapped card has to stand out a bit more.
    const preference = sideways ? 0.95 : 1;
    for (const tolerance of SHAPE_TOLERANCES) {
      const ratio = sideways ? 1 / (CARD_RATIO * tolerance) : CARD_RATIO * tolerance;
      for (let w = minSide; w < width - 2; w += Math.max(1, Math.round(w / 40))) {
        const h = Math.round(w / ratio);
        if (h >= height - 2 || h < minSide) continue;
        const xFrom = Math.max(1, px - w + 2);
        const xTo = Math.min(width - 2 - w, px - 2);
        const yFrom = Math.max(1, py - h + 2);
        const yTo = Math.min(height - 2 - h, py - 2);
        for (let x0 = xFrom; x0 <= xTo; x0++) {
          const leftColumn = x0 * (height + 1);
          const rightColumn = (x0 + w) * (height + 1);
          for (let y0 = yFrom; y0 <= yTo; y0++) {
            const topRow = y0 * (width + 1) + x0;
            const bottomRow = (y0 + h) * (width + 1) + x0;
            // Each side in a few stretches: a card's edge runs all the way, while a rectangle made up from
            // the edges of different things has gaps.
            const left = side(columns, leftColumn + y0, h);
            const right = side(columns, rightColumn + y0, h);
            const top = side(rows, topRow, w);
            const bottom = side(rows, bottomRow, w);
            const score = (Math.min(left, right, top, bottom) * 0.6 + (left + right + top + bottom) * 0.1) * preference;
            if (score > bestScore * NEAR_BEST) {
              bestScore = Math.max(bestScore, score);
              near.push({ rect: { x: x0, y: y0, width: w, height: h }, clarity: score });
            }
          }
        }
      }
    }
  }
  // A card's art box or text box can stand out nearly as well as the card. The card is around them.
  const contenders = near.filter((candidate) => candidate.clarity >= bestScore * NEAR_BEST);
  const area = (r: Rectangle) => r.rect.width * r.rect.height;
  let best = contenders.reduce<Rectangle | null>((a, b) => (a && area(a) >= area(b) ? a : b), null);
  if (!best) return null;
  // But two cards side by side make the shape of a card lying the other way (two upright cards, one tapped
  // card's shape). Then each card is about half of it, sharing three of its sides, and stands out more than
  // the two together, whose long sides break where the cards meet (a gap, or at least their round corners):
  // the half with the point in it is the card. A card's own art can make a half like that too, but the card's
  // sides run on past it.
  const whole = best;
  const halves = contenders.filter(
    (candidate) =>
      candidate.clarity >= whole.clarity * HALF_STANDOUT &&
      isHalfOf(candidate.rect, whole.rect) &&
      breaksBeside(candidate.rect, whole.rect, columns, rows, width, height),
  );
  if (halves.length > 0) best = halves.reduce((a, b) => (a.clarity >= b.clarity ? a : b));
  return { rect: tighten(best.rect, columns, rows, width, height), clarity: best.clarity / (average * 2) };
}

/**
 * Whether a rectangle is about half of another, the other way round, along three of its sides: one of two
 * cards side by side, in the rectangle around both.
 */
function isHalfOf(part: PixelRect, whole: PixelRect): boolean {
  if (part.width > part.height === whole.width > whole.height) return false;
  const share = (part.width * part.height) / (whole.width * whole.height);
  if (share < HALF_SHARE[0] || share > HALF_SHARE[1]) return false;
  // Two cards (and the gap between them) are at least twice as long as one is wide. A card's top part down to
  // the bottom of its art box shares three sides with it too, but is over half as deep as the card is long.
  const [long, short] = [Math.max(whole.width, whole.height), Math.min(part.width, part.height)];
  if (long < short * 2 * HALF_LENGTH) return false;
  const tolerance = Math.max(2, Math.min(whole.width, whole.height) * HALF_SIDE_TOLERANCE);
  const near = (a: number, b: number) => Math.abs(a - b) <= tolerance;
  const shared = [
    near(part.x, whole.x),
    near(part.y, whole.y),
    near(part.x + part.width, whole.x + whole.width),
    near(part.y + part.height, whole.y + whole.height),
  ].filter(Boolean).length;
  return shared >= 3;
}

/**
 * Whether the whole's long sides break (their edge weakens) where the half ends: where two cards meet. Each
 * side is taken as the strongest of the lines a pixel either side, as edges can be a pixel off.
 */
function breaksBeside(
  half: PixelRect,
  whole: PixelRect,
  columns: Float64Array,
  rows: Float64Array,
  width: number,
  height: number,
): boolean {
  const sideways = whole.width > whole.height;
  // Along the long sides: from, to, and where the half ends.
  const [from, to] = sideways ? [whole.x, whole.x + whole.width] : [whole.y, whole.y + whole.height];
  const [halfFrom, halfTo] = sideways ? [half.x, half.x + half.width] : [half.y, half.y + half.height];
  const split = Math.abs(halfFrom - from) < Math.abs(halfTo - to) ? halfTo : halfFrom;
  const reach = Math.max(1, Math.round(Math.min(half.width, half.height) * BREAK_REACH));
  const a = Math.max(from, Math.round(split - reach));
  const b = Math.min(to, Math.round(split + reach));
  if (b - a < 2 || to - from < 4) return false;
  // Average edge strength along a line from p to q: across columns (sideways) or down rows.
  const strength = (line: number, p: number, q: number) => {
    if (sideways) {
      if (line < 0 || line >= height) return 0;
      return (rows[line * (width + 1) + q]! - rows[line * (width + 1) + p]!) / (q - p);
    }
    if (line < 0 || line >= width) return 0;
    return (columns[line * (height + 1) + q]! - columns[line * (height + 1) + p]!) / (q - p);
  };
  const sides = sideways ? [whole.y, whole.y + whole.height] : [whole.x, whole.x + whole.width];
  return sides.every((side) => {
    const lines = [side - 1, side, side + 1];
    const along = Math.max(...lines.map((line) => strength(line, from, to)));
    const there = Math.max(...lines.map((line) => strength(line, a, b)));
    return along > 0 && there < along * BREAK;
  });
}

/**
 * Moves each edge of the rectangle, on its own, a little in or out to where the picture's edge is strongest.
 * The search tries sizes in steps and only a few shapes; this makes up the difference.
 */
function tighten(rect: PixelRect, columns: Float64Array, rows: Float64Array, width: number, height: number): PixelRect {
  const reach = Math.max(2, Math.round(Math.max(rect.width, rect.height) * 0.04));
  const along = (sums: Float64Array, line: number, lineLength: number, from: number, length: number) =>
    side(sums, line * (lineLength + 1) + from, length);
  let { x: left, y: top } = rect;
  let right = rect.x + rect.width;
  let bottom = rect.y + rect.height;
  const strongest = (current: number, min: number, max: number, strength: (position: number) => number) => {
    let best = current;
    let bestStrength = strength(current);
    for (let position = Math.max(min, current - reach); position <= Math.min(max, current + reach); position++) {
      const value = strength(position);
      if (value > bestStrength) [best, bestStrength] = [position, value];
    }
    return best;
  };
  left = strongest(left, 1, right - 8, (x) => along(columns, x, height, top, bottom - top));
  right = strongest(right, left + 8, width - 2, (x) => along(columns, x, height, top, bottom - top));
  top = strongest(top, 1, bottom - 8, (y) => along(rows, y, width, left, right - left));
  bottom = strongest(bottom, top + 8, height - 2, (y) => along(rows, y, width, left, right - left));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

const STRETCHES = 3;
/** Rectangles scoring at least this share of the best are in the running for being the card's outline. */
const NEAR_BEST = 0.75;
/** One of two cards side by side is this share of the rectangle around both (less with a gap between them). */
const HALF_SHARE = [0.43, 0.6] as const;
/** How near a side of the whole one of the halves' sides is, as a share of the whole's shorter side. */
const HALF_SIDE_TOLERANCE = 0.07;
/** Two cards side by side are at least this share of twice one card's width long (outlines aren't exact). */
const HALF_LENGTH = 0.96;
/**
 * One of two cards stands out at least this much more than both together (about 1.2 to 1.3 times, in tests);
 * a card's own half, less than the card.
 */
const HALF_STANDOUT = 1.15;
/** Around where two cards would meet, as a share of a card's width: how much of the long sides is looked at. */
const BREAK_REACH = 0.08;
/** Long sides weaker than this share of their average there break: two cards meet. */
const BREAK = 0.7;

/** How strongly an edge runs along a side: its average strength, held back by its weakest stretch. */
function side(sums: Float64Array, start: number, length: number): number {
  let weakest = Infinity;
  const step = length / STRETCHES;
  for (let k = 0; k < STRETCHES; k++) {
    const from = start + Math.round(k * step);
    const to = start + Math.round((k + 1) * step);
    weakest = Math.min(weakest, (sums[to]! - sums[from]!) / (to - from));
  }
  return 0.5 * weakest + (0.5 * (sums[start + length]! - sums[start]!)) / length;
}

/** An edge's strength at a pixel, or its neighbor's across the edge if stronger. */
function spread(
  gradient: Float32Array,
  valid: Uint8Array,
  width: number,
  x: number,
  y: number,
  dx: number,
  dy: number,
): number {
  const i = y * width + x;
  let value = valid[i] ? Math.abs(gradient[i]!) : 0;
  for (const step of [-1, 1]) {
    const nx = x + dx * step;
    const ny = y + dy * step;
    if (nx < 0 || ny < 0 || nx >= width || ny * width >= gradient.length) continue;
    const j = ny * width + nx;
    if (valid[j]) value = Math.max(value, Math.abs(gradient[j]!) * 0.8);
  }
  return value;
}

/** Gaussian blur; NaN (outside the picture) stays NaN. */
function blur(gray: GrayImage, sigma: number): GrayImage {
  const radius = Math.ceil(sigma * 2.5);
  const kernel: number[] = [];
  for (let k = -radius; k <= radius; k++) kernel.push(Math.exp(-(k * k) / (2 * sigma * sigma)));
  const { width, height } = gray;
  const pass = (source: Float32Array, dx: number, dy: number): Float32Array => {
    const out = new Float32Array(source.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0;
        let weight = 0;
        for (let k = -radius; k <= radius; k++) {
          const nx = Math.min(width - 1, Math.max(0, x + k * dx));
          const ny = Math.min(height - 1, Math.max(0, y + k * dy));
          const value = source[ny * width + nx]!;
          if (Number.isNaN(value)) continue;
          sum += value * kernel[k + radius]!;
          weight += kernel[k + radius]!;
        }
        out[y * width + x] = Number.isNaN(source[y * width + x]!) || weight === 0 ? Number.NaN : sum / weight;
      }
    }
    return out;
  };
  return { width, height, data: pass(pass(gray.data, 1, 0), 0, 1) };
}

/** Sobel edges. Pixels next to the outside of the picture (or of a turned picture) have none. */
function sobel(gray: GrayImage): { gx: Float32Array; gy: Float32Array; valid: Uint8Array } {
  const { width, height, data } = gray;
  const gx = new Float32Array(width * height);
  const gy = new Float32Array(width * height);
  const valid = new Uint8Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const a = data[i - width - 1]!;
      const b = data[i - width]!;
      const c = data[i - width + 1]!;
      const d = data[i - 1]!;
      const f = data[i + 1]!;
      const g = data[i + width - 1]!;
      const h = data[i + width]!;
      const k = data[i + width + 1]!;
      if (Number.isNaN(a + b + c + d + f + g + h + k + data[i]!)) continue;
      gx[i] = c + 2 * f + k - a - 2 * d - g;
      gy[i] = g + 2 * h + k - a - 2 * b - c;
      valid[i] = 1;
    }
  }
  return { gx, gy, valid };
}

/** The picture turned clockwise around its middle, same size. Corners turned in from outside are NaN. */
function turnGray(gray: GrayImage, angle: number): GrayImage {
  if (angle === 0) return gray;
  const { width, height, data } = gray;
  const out = new Float32Array(width * height);
  const radians = (angle * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const cx = width / 2;
  const cy = height / 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tx = x + 0.5 - cx;
      const ty = y + 0.5 - cy;
      const sx = cos * tx + sin * ty + cx - 0.5;
      const sy = -sin * tx + cos * ty + cy - 0.5;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      if (x0 < 0 || y0 < 0 || x0 >= width - 1 || y0 >= height - 1) {
        out[y * width + x] = Number.NaN;
        continue;
      }
      const fx = sx - x0;
      const fy = sy - y0;
      const i = y0 * width + x0;
      out[y * width + x] =
        (data[i]! * (1 - fx) + data[i + 1]! * fx) * (1 - fy) +
        (data[i + width]! * (1 - fx) + data[i + width + 1]! * fx) * fy;
    }
  }
  return { width, height, data: out };
}

/** Where a point of the picture ends up when the picture is turned clockwise around its middle. */
function turnPoint(point: { x: number; y: number }, angle: number, width: number, height: number) {
  const radians = (angle * Math.PI) / 180;
  const tx = point.x - width / 2;
  const ty = point.y - height / 2;
  return {
    x: Math.cos(radians) * tx - Math.sin(radians) * ty + width / 2,
    y: Math.sin(radians) * tx + Math.cos(radians) * ty + height / 2,
  };
}

function quantile(values: Float32Array, q: number): number {
  const sorted = Float32Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
}
