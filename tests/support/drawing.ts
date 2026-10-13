import type { RgbaImage } from '@commander-brawl/application';

/** Pictures of cards on a table, drawn for tests. Edges are smoothed like a camera's, or tilt finding is off. */

export type Color = readonly [number, number, number];

export interface Picture extends RgbaImage {
  readonly data: Uint8ClampedArray;
}

export function blank(width: number, height: number, color: Color): Picture {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([...color, 255], i * 4);
  return { width, height, data };
}

/** Deterministic grain, like a camera's noise. */
export function addNoise(picture: Picture, amount: number, seed = 1): void {
  let state = seed;
  const random = () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
  for (let i = 0; i < picture.data.length; i += 4) {
    const shift = (random() - 0.5) * 2 * amount;
    for (let c = 0; c < 3; c++) picture.data[i + c] = picture.data[i + c]! + shift;
  }
}

/** Colors a rectangle turned clockwise by `angle` degrees around its middle, with smoothed edges. */
export function fillRect(
  picture: Picture,
  rect: { cx: number; cy: number; width: number; height: number; angle: number },
  color: Color | ((u: number, v: number) => Color),
): void {
  const radians = (rect.angle * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const reach = Math.hypot(rect.width, rect.height) / 2 + 1;
  const samples = 4;
  for (let y = Math.max(0, Math.floor(rect.cy - reach)); y < Math.min(picture.height, rect.cy + reach); y++) {
    for (let x = Math.max(0, Math.floor(rect.cx - reach)); x < Math.min(picture.width, rect.cx + reach); x++) {
      let inside = 0;
      let u = 0;
      let v = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const px = x + (sx + 0.5) / samples - rect.cx;
          const py = y + (sy + 0.5) / samples - rect.cy;
          // Into the rectangle's own coordinates: undo the turn.
          const ru = cos * px + sin * py;
          const rv = -sin * px + cos * py;
          if (Math.abs(ru) <= rect.width / 2 && Math.abs(rv) <= rect.height / 2) {
            inside++;
            u = ru / rect.width + 0.5;
            v = rv / rect.height + 0.5;
          }
        }
      }
      if (inside === 0) continue;
      const share = inside / (samples * samples);
      const fill = typeof color === 'function' ? color(u, v) : color;
      const i = (y * picture.width + x) * 4;
      for (let c = 0; c < 3; c++) picture.data[i + c] = picture.data[i + c]! * (1 - share) + fill[c]! * share;
    }
  }
}

export interface DrawnCard {
  readonly cx: number;
  readonly cy: number;
  /** The card's width in pixels; its height follows from a card's shape. */
  readonly width: number;
  /** Clockwise, in degrees. 90 is tapped. */
  readonly angle: number;
  /** The artwork: a color for each point, u and v from 0 to 1 across the art box. */
  readonly art: (u: number, v: number) => Color;
  /** The name bar's color, to tell which way up a card is. */
  readonly nameBar?: Color;
}

/**
 * A card the way a camera sees one: black border, colored frame, name bar, art box, type line and text box,
 * where real cards have them.
 */
export function drawCard(picture: Picture, card: DrawnCard): void {
  const height = (card.width * 88) / 63;
  const radians = (card.angle * Math.PI) / 180;
  // A part of the card, from shares of its width and height (left, top, right, bottom).
  const part = (left: number, top: number, right: number, bottom: number) => {
    const ox = ((left + right) / 2 - 0.5) * card.width;
    const oy = ((top + bottom) / 2 - 0.5) * height;
    return {
      cx: card.cx + Math.cos(radians) * ox - Math.sin(radians) * oy,
      cy: card.cy + Math.sin(radians) * ox + Math.cos(radians) * oy,
      width: (right - left) * card.width,
      height: (bottom - top) * height,
      angle: card.angle,
    };
  };
  fillRect(picture, part(0, 0, 1, 1), [18, 18, 20]);
  fillRect(picture, part(0.035, 0.027, 0.965, 0.973), [120, 130, 150]);
  fillRect(picture, part(0.06, 0.04, 0.94, 0.095), card.nameBar ?? [225, 225, 215]);
  fillRect(picture, part(0.082, 0.112, 0.918, 0.556), card.art);
  fillRect(picture, part(0.06, 0.565, 0.94, 0.615), [225, 225, 215]);
  fillRect(picture, part(0.08, 0.63, 0.92, 0.92), [235, 232, 222]);
}

/** Some artwork: a color gradient with blobs of color on it, different for every seed. */
export function artwork(seed: number): (u: number, v: number) => Color {
  let state = (seed * 2_654_435_761) % 4_294_967_296;
  const random = () => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return state / 4_294_967_296;
  };
  const color = (): Color => [random() * 255, random() * 255, random() * 255];
  const [from, to] = [color(), color()];
  const direction = random() * Math.PI * 2;
  const blobs = Array.from({ length: 6 }, () => ({
    x: random(),
    y: random(),
    size: 0.08 + random() * 0.25,
    color: color(),
  }));
  return (u, v) => {
    for (const blob of blobs) if (Math.hypot(u - blob.x, (v - blob.y) * 0.75) < blob.size) return blob.color;
    const t = Math.min(1, Math.max(0, 0.5 + (u - 0.5) * Math.cos(direction) + (v - 0.5) * Math.sin(direction)));
    return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t];
  };
}
