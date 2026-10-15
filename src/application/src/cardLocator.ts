import { cardCorners, dominantTilt, findCard } from './cardFinder';
import type { Point, Quad } from './perspective';
import { crop, toGray, type RgbaImage } from './pixels';
import { clampCrop, type CropRect } from './snapshots';

/** A card found where a player clicked on someone's video. Both as fractions of the video's picture. */
export interface LocatedCard {
  /** The card's corners, clockwise. */
  readonly outline: Quad;
  /** The card and a little room around it: the part to ask that player's camera for. */
  readonly crop: CropRect;
}

/**
 * The searched part of the picture around the click, as a share of the picture's shorter side: room for a
 * card held up to fill the picture's height, wherever on it the click was.
 */
const SEARCH_SIZE = 1.25;
/** Cards this small (as a share of the searched part's shorter side; see FindCardOptions.minSize) and up. */
const MIN_SIZE = 0.1;
/** Around the click, where a card's own lines tell its tilt: a share of the picture's shorter side. */
const PATCH_SIZE = 0.3;
/** Pictures are shrunk to this to measure the tilt. */
const TILT_SIZE = 160;
/** How clearly the outline has to stand out. A little less than for a sharp picture: video is blurrier. */
const MIN_CLARITY = 0.8;
/**
 * Room around the card in the picture asked for, as a share of its size: the outline is from a smaller,
 * blurrier picture, and may be just inside the card's black border.
 */
const MARGIN = 0.15;
/**
 * Without an outline, and no card found before on that video: the part asked for, as shares of the picture's width
 * and height. About a card and a bit at a webcam's usual distance, card-shaped on a 16:9 picture.
 */
const GUESS_WIDTH = 0.1;
const GUESS_HEIGHT = 0.25;
/** Without an outline, but with the size of cards found on that video: this many cards' size around the click. */
const GUESS_CARDS = 1.6;

/**
 * Finds the card at a point of a video picture (as fractions), so the whole card is asked for wherever on it
 * the click was, however big it is in the picture. Null if no card's outline stands out there.
 */
export function locateCardAt(frame: RgbaImage, point: Point): LocatedCard | null {
  const side = Math.min(frame.width, frame.height) * SEARCH_SIZE;
  const width = Math.min(frame.width, Math.round(side));
  const height = Math.min(frame.height, Math.round(side));
  const px = point.x * frame.width;
  const py = point.y * frame.height;
  const area = {
    x: Math.round(Math.min(Math.max(0, px - width / 2), frame.width - width)),
    y: Math.round(Math.min(Math.max(0, py - height / 2), frame.height - height)),
    width,
    height,
  };
  const part = crop(frame, area);
  // The card's tilt: from right around the click, where the card is most of what's there, and from the whole
  // part searched, in case the card is big and its edges are what's around the click.
  const patchSide = Math.min(frame.width, frame.height) * PATCH_SIZE;
  const patch = crop(frame, {
    x: Math.max(0, px - patchSide / 2),
    y: Math.max(0, py - patchSide / 2),
    width: patchSide,
    height: patchSide,
  });
  const angles = [-dominantTilt(toGray(patch, TILT_SIZE)), -dominantTilt(toGray(part, TILT_SIZE))];
  const found = findCard(part, {
    point: { x: px - area.x, y: py - area.y },
    minSize: MIN_SIZE,
    angles: Math.abs(angles[0]! - angles[1]!) < 1 ? [angles[0]!] : angles,
  });
  if (!found || found.clarity < MIN_CLARITY) return null;
  const outline = cardCorners(found, part.width, part.height).map((corner) => ({
    x: (corner.x + area.x) / frame.width,
    y: (corner.y + area.y) / frame.height,
  })) as unknown as Quad;
  return { outline, crop: around(outline, MARGIN) };
}

/**
 * A card picked out by drawing a rectangle around it on the video (two opposite corners, as fractions): that
 * rectangle is its outline, and it and a little room around it are asked for.
 */
export function cardInArea(from: Point, to: Point): LocatedCard {
  const [left, right] = [Math.min(from.x, to.x), Math.max(from.x, to.x)];
  const [top, bottom] = [Math.min(from.y, to.y), Math.max(from.y, to.y)];
  const outline: Quad = [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];
  return { outline, crop: around(outline, MARGIN) };
}

/**
 * Where to look without an outline: a part of the picture around the point. Given how big the cards found on the
 * same video were (cards on a table are about the same size), a bit more than one of those, so it's the card clicked
 * and not its neighbors too; otherwise a generous part.
 */
export function guessCardCrop(
  point: Point,
  cardSize?: { readonly width: number; readonly height: number },
  /** The picture's width over its height. */
  aspect = 16 / 9,
): CropRect {
  // A card the other way (tapped) still fits: its longer side, both ways (in pixels, so the picture's shape counts).
  const width = cardSize ? Math.max(cardSize.width, cardSize.height / aspect) * GUESS_CARDS : GUESS_WIDTH;
  const height = cardSize ? Math.max(cardSize.width * aspect, cardSize.height) * GUESS_CARDS : GUESS_HEIGHT;
  return clampCrop({ x: point.x - width / 2, y: point.y - height / 2, width, height });
}

/** How big a found card is on its picture, as shares of the picture's width and height. */
export function cardSizeOf(card: LocatedCard): { readonly width: number; readonly height: number } {
  const xs = card.outline.map((corner) => corner.x);
  const ys = card.outline.map((corner) => corner.y);
  return { width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

/** The rectangle around four corners, grown by a share of its size on every side, inside the picture. */
function around(corners: Quad, margin: number): CropRect {
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const width = Math.max(...xs) - left;
  const height = Math.max(...ys) - top;
  const x = Math.max(0, left - width * margin);
  const y = Math.max(0, top - height * margin);
  return clampCrop({
    x,
    y,
    width: Math.min(1, left + width * (1 + margin)) - x,
    height: Math.min(1, top + height * (1 + margin)) - y,
  });
}
