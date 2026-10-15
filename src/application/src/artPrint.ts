import type { RgbaImage } from './pixels';

/**
 * A rough print of a card's artwork: its brightness and colors on a coarse grid, so a camera picture of
 * a card can be compared with the card's official picture despite blur, glare and a different camera.
 */
export interface ArtPrint {
  readonly values: Float32Array;
}

const COLUMNS = 16;
const ROWS = 12;
/** Brightness tells most; the two color differences tell the rest. */
const WEIGHTS = [0.5, 0.25, 0.25];

/**
 * The part of a card (as a share of its width and height) that's artwork on almost every card. Inside the
 * art box with a margin, whether or not the card's border made it into the picture.
 */
const ART_ON_CARD = { x: 0.14, y: 0.16, width: 0.72, height: 0.34 };
/** The same part, in a picture of just the artwork (Scryfall's "art crop"). */
const ART_IN_CROP = { x: 0.085, y: 0.13, width: 0.83, height: 0.74 };

/** The artwork's print, from a straightened picture of the whole card. */
export function artOfCard(card: RgbaImage): ArtPrint {
  return printOf(card, ART_ON_CARD);
}

/** How far the art part is moved (as a share of the card's height; across, only the smaller ones) and resized. */
const SHIFTS = [-0.08, -0.04, 0, 0.04, 0.08];
const SIDEWAYS_SHIFTS = [-0.04, 0, 0.04];
const SCALES = [0.92, 1, 1.08];

/**
 * The artwork's print from a straightened picture of the whole card, the part looked at moved and resized a little
 * each way: an outline found a bit off (around a sleeve, or a card next to it) still has the artwork in it, in one of
 * them. Compare with all, and take the most alike.
 */
export function artsOfCard(card: RgbaImage): ArtPrint[] {
  const prints: ArtPrint[] = [];
  for (const scale of SCALES) {
    const width = ART_ON_CARD.width * scale;
    const height = ART_ON_CARD.height * scale;
    for (const dy of SHIFTS) {
      for (const dx of SIDEWAYS_SHIFTS) {
        prints.push(
          printOf(card, {
            x: ART_ON_CARD.x + (ART_ON_CARD.width - width) / 2 + dx,
            y: ART_ON_CARD.y + (ART_ON_CARD.height - height) / 2 + dy,
            width,
            height,
          }),
        );
      }
    }
  }
  return prints;
}

/** The artwork's print, from a picture of only the artwork. */
export function artOfArtCrop(art: RgbaImage): ArtPrint {
  return printOf(art, ART_IN_CROP);
}

/** How alike two artworks look: 1 is the same picture, around 0 unrelated ones. */
export function artSimilarity(a: ArtPrint, b: ArtPrint): number {
  const cells = COLUMNS * ROWS;
  let total = 0;
  for (let channel = 0; channel < WEIGHTS.length; channel++) {
    let dot = 0;
    for (let i = channel * cells; i < (channel + 1) * cells; i++) dot += a.values[i]! * b.values[i]!;
    total += dot * WEIGHTS[channel]!;
  }
  return total;
}

function printOf(image: RgbaImage, area: { x: number; y: number; width: number; height: number }): ArtPrint {
  const cells = COLUMNS * ROWS;
  const sums = new Float64Array(cells * 3);
  const counts = new Float64Array(cells);
  const x0 = Math.floor(area.x * image.width);
  const y0 = Math.floor(area.y * image.height);
  const x1 = Math.max(x0 + COLUMNS, Math.floor((area.x + area.width) * image.width));
  const y1 = Math.max(y0 + ROWS, Math.floor((area.y + area.height) * image.height));
  for (let y = Math.max(0, y0); y < Math.min(y1, image.height); y++) {
    const row = Math.floor(((y - y0) / (y1 - y0)) * ROWS);
    for (let x = Math.max(0, x0); x < Math.min(x1, image.width); x++) {
      const i = (y * image.width + x) * 4;
      if (image.data[i + 3] === 0) continue;
      const cell = row * COLUMNS + Math.floor(((x - x0) / (x1 - x0)) * COLUMNS);
      const r = image.data[i]!;
      const g = image.data[i + 1]!;
      const b = image.data[i + 2]!;
      sums[cell]! += 0.299 * r + 0.587 * g + 0.114 * b;
      sums[cells + cell]! += r - g;
      sums[2 * cells + cell]! += (r + g) / 2 - b;
      counts[cell]! += 1;
    }
  }
  const values = new Float32Array(cells * 3);
  for (let channel = 0; channel < 3; channel++) {
    let mean = 0;
    for (let cell = 0; cell < cells; cell++) {
      const value = counts[cell]! > 0 ? sums[channel * cells + cell]! / counts[cell]! : 0;
      values[channel * cells + cell] = value;
      mean += value / cells;
    }
    // Zero mean and unit length per channel: a dimmer or tinted camera picture compares the same.
    let length = 0;
    for (let cell = 0; cell < cells; cell++) {
      const value = values[channel * cells + cell]! - mean;
      values[channel * cells + cell] = value;
      length += value * value;
    }
    // A nearly flat channel (a gray picture's colors) is mostly noise; don't blow it up.
    const norm = Math.max(Math.sqrt(length), 8 * Math.sqrt(cells));
    for (let cell = 0; cell < cells; cell++) values[channel * cells + cell]! /= norm;
  }
  return { values };
}
