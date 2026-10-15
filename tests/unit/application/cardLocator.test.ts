import {
  cardInArea,
  cardSizeOf,
  guessCardCrop,
  locateCardAt,
  type CropRect,
  type Point,
  type Quad,
} from '@commander-brawl/application';
import { describe, expect, it } from 'vitest';
import { addNoise, artwork, blank, drawCard, fillRect, type DrawnCard, type Picture } from '../../support/drawing';

const MAT = [40, 58, 50] as const;
/**
 * How far off an outline's corners may be, in pixels: the card's black border and frame, which it may or may
 * not count (a share of the card's width), and a pixel or two of the shrunk picture the search works on.
 */
const tolerance = (card: Omit<DrawnCard, 'art'>) => card.width * 0.08 + 3;

/** A video picture (a shrunk 16:9 frame) with cards on a playmat. */
function video(cards: readonly Omit<DrawnCard, 'art'>[], background?: (picture: Picture) => void): Picture {
  const picture = blank(480, 270, MAT);
  background?.(picture);
  cards.forEach((card, i) => drawCard(picture, { ...card, art: artwork(i + 1) }));
  addNoise(picture, 8);
  return picture;
}

/** A drawn card's corners, as fractions of the picture. */
function cornersOf(card: Omit<DrawnCard, 'art'>, picture: Picture): Point[] {
  const height = (card.width * 88) / 63;
  const radians = (card.angle * Math.PI) / 180;
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([u, v]) => {
    const ox = (u! * card.width) / 2;
    const oy = (v! * height) / 2;
    return {
      x: (card.cx + Math.cos(radians) * ox - Math.sin(radians) * oy) / picture.width,
      y: (card.cy + Math.sin(radians) * ox + Math.cos(radians) * oy) / picture.height,
    };
  });
}

/** How far the outline's corners are from the card's at worst, in pixels. */
function outlineError(outline: Quad, card: Omit<DrawnCard, 'art'>, picture: Picture): number {
  const corners = cornersOf(card, picture);
  return Math.max(
    ...corners.map((corner) =>
      Math.min(...outline.map((o) => Math.hypot((o.x - corner.x) * picture.width, (o.y - corner.y) * picture.height))),
    ),
  );
}

function contains(crop: CropRect, point: Point): boolean {
  const slack = 0.002;
  return (
    point.x >= crop.x - slack &&
    point.x <= crop.x + crop.width + slack &&
    point.y >= crop.y - slack &&
    point.y <= crop.y + crop.height + slack
  );
}

const at = (card: Omit<DrawnCard, 'art'>, picture: Picture, dx = 0, dy = 0): Point => ({
  x: (card.cx + dx) / picture.width,
  y: (card.cy + dy) / picture.height,
});

describe('finding the card that was clicked on a video', () => {
  it('finds all of a card held up close, clicked near its edge', () => {
    // Most of the picture's height, as when a card is held up to a webcam.
    const card = { cx: 250, cy: 140, width: 115, angle: 3 };
    const picture = video([card]);
    for (const [dx, dy] of [
      [0, 0],
      [-40, -60],
      [35, 65],
    ] as const) {
      const found = locateCardAt(picture, at(card, picture, dx, dy));
      expect(found, `clicked at ${dx},${dy}`).not.toBeNull();
      // On the card's edge, or just inside its black border.
      expect(outlineError(found!.outline, card, picture), `clicked at ${dx},${dy}`).toBeLessThan(tolerance(card));
      // The whole card is asked for, with a little room, not a fixed box around the click.
      for (const corner of cornersOf(card, picture)) {
        expect(contains(found!.crop, corner), `clicked at ${dx},${dy}`).toBe(true);
      }
      expect(found!.crop.height).toBeLessThan(1);
    }
  });

  it('finds a small card on a playmat, not its neighbors', () => {
    const cards = [
      { cx: 150, cy: 130, width: 46, angle: 0 },
      { cx: 205, cy: 130, width: 46, angle: 0 },
      { cx: 275, cy: 138, width: 46, angle: 90 },
    ];
    const picture = video(cards);
    cards.forEach((card, i) => {
      const found = locateCardAt(picture, at(card, picture, 4, -6));
      expect(found, `card ${i}`).not.toBeNull();
      expect(outlineError(found!.outline, card, picture), `card ${i}`).toBeLessThan(tolerance(card));
      for (const corner of cornersOf(card, picture)) expect(contains(found!.crop, corner), `card ${i}`).toBe(true);
    });
  });

  it('finds the one of two cards nearly touching that was clicked, not both', () => {
    // Side by side, two upright cards make the shape of a tapped card; one above the other, two tapped cards
    // make the shape of an upright one.
    const pairs = [
      [
        { cx: 208, cy: 135, width: 60, angle: 2 },
        { cx: 271, cy: 135, width: 60, angle: 2 },
      ],
      [
        { cx: 240, cy: 108, width: 50, angle: 90 },
        { cx: 240, cy: 162, width: 50, angle: 90 },
      ],
    ];
    for (const pair of pairs) {
      const picture = video(pair);
      pair.forEach((card, i) => {
        const found = locateCardAt(picture, at(card, picture, 6, -4));
        expect(found, `card ${i} at ${card.angle}°`).not.toBeNull();
        expect(outlineError(found!.outline, card, picture), `card ${i} at ${card.angle}°`).toBeLessThan(
          tolerance(card),
        );
      });
    }
  });

  it('finds the one card clicked in a group of four, which together make the shape of a card', () => {
    // Two by two, the four make a card-shaped rectangle; each card stands out more on its own.
    const cards = [
      { cx: 210, cy: 92, width: 56, angle: 1 },
      { cx: 270, cy: 92, width: 56, angle: 1 },
      { cx: 210, cy: 175, width: 56, angle: 1 },
      { cx: 270, cy: 175, width: 56, angle: 1 },
    ];
    const picture = video(cards);
    cards.forEach((card, i) => {
      const found = locateCardAt(picture, at(card, picture, 5, 8));
      expect(found, `card ${i}`).not.toBeNull();
      expect(outlineError(found!.outline, card, picture), `card ${i}`).toBeLessThan(tolerance(card));
    });
  });

  it('finds the one card clicked in a row of three', () => {
    const cards = [
      { cx: 180, cy: 135, width: 56, angle: 0 },
      { cx: 240, cy: 135, width: 56, angle: 0 },
      { cx: 300, cy: 135, width: 56, angle: 0 },
    ];
    const picture = video(cards);
    cards.forEach((card, i) => {
      const found = locateCardAt(picture, at(card, picture, -5, 6));
      expect(found, `card ${i}`).not.toBeNull();
      expect(outlineError(found!.outline, card, picture), `card ${i}`).toBeLessThan(tolerance(card));
    });
  });

  it('finds a tilted card in front of a busy background', () => {
    const card = { cx: 240, cy: 150, width: 90, angle: -12 };
    const picture = video([card], (p) => {
      // Diagonal stripes, like a patterned cloth behind the card.
      for (let i = -10; i < 30; i++) {
        fillRect(p, { cx: i * 30, cy: 135, width: 9, height: 600, angle: 35 }, [150, 120, 90]);
      }
    });
    const found = locateCardAt(picture, at(card, picture, 10, 20));
    expect(found).not.toBeNull();
    expect(outlineError(found!.outline, card, picture)).toBeLessThan(tolerance(card));
  });

  it('takes a box drawn around a card as its outline, drawn either way', () => {
    const found = cardInArea({ x: 0.6, y: 0.7 }, { x: 0.4, y: 0.3 });
    expect(found.outline).toEqual([
      { x: 0.4, y: 0.3 },
      { x: 0.6, y: 0.3 },
      { x: 0.6, y: 0.7 },
      { x: 0.4, y: 0.7 },
    ]);
    // Asked for with a little room around it.
    for (const corner of found.outline) expect(contains(found.crop, corner)).toBe(true);
    expect(found.crop.width).toBeGreaterThan(0.2);
    expect(found.crop.width).toBeLessThan(0.3);
  });

  it('finds nothing on an empty playmat, and then guesses a part around the click', () => {
    const picture = video([]);
    const point = { x: 0.9, y: 0.5 };
    expect(locateCardAt(picture, point)).toBeNull();
    const guess = guessCardCrop(point);
    expect(contains(guess, point)).toBe(true);
    expect(guess.x + guess.width).toBeLessThanOrEqual(1);
    expect(guess.height).toBeGreaterThan(guess.width);
    // Not most of the picture: a card or two around the click.
    expect(guess.width * guess.height).toBeLessThan(0.15);
  });

  it('guesses about one card around the click, given how big the cards found on that video are', () => {
    const card = { cx: 240, cy: 135, width: 46, angle: 0 };
    const picture = video([card]);
    const found = locateCardAt(picture, at(card, picture))!;
    const size = cardSizeOf(found);
    expect(size.width * picture.width).toBeCloseTo(46, -1);
    const guess = guessCardCrop({ x: 0.3, y: 0.4 }, size, picture.width / picture.height);
    expect(contains(guess, { x: 0.3, y: 0.4 })).toBe(true);
    // Room for the card, wherever on it the click was, and lying either way; not for its neighbors.
    expect(guess.height).toBeGreaterThan(size.height * 1.4);
    expect(guess.height).toBeLessThan(size.height * 2);
    expect(guess.width * picture.width).toBeLessThan(size.width * picture.width * 3);
  });
});
