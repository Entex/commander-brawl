import {
  CardIdentifier,
  CardIndex,
  artOfArtCrop,
  nameSimilarity,
  toGray,
  type ArtLibrary,
  type ArtPrint,
  type CardCatalog,
  type Quad,
  type RgbaImage,
  type TextReader,
} from '@commander-brawl/application';
import type { Card } from '@commander-brawl/domain';
import { describe, expect, it } from 'vitest';
import { addNoise, artwork, blank, drawCard, fillRect, type Color } from '../../support/drawing';

function card(name: string, art: number): Card & { art: number } {
  return {
    id: name.toLowerCase().replace(/\W+/g, '-'),
    name,
    layout: 'normal',
    manaCost: '',
    typeLine: '',
    oracleText: '',
    stats: '',
    colorIdentity: [],
    manaValue: 0,
    commander: 'legal',
    gameChanger: false,
    image: `${name}.jpg`,
    artist: null,
    faces: [],
    art,
  };
}

const deck = [card('Rhystic Study', 1), card('Sol Ring', 2), card('Cultivate', 3), card('Swords to Plowshares', 4)];
const others = [card('Rhystic Tutor', 5), card('Counterspell', 6), card('Smothering Tithe', 7), card('Smother', 8)];
const catalog = new CardIndex([...deck, ...others]);
const RED: Color = [200, 40, 40];

/** Official artwork pictures, drawn the same as on the cards in the test pictures. */
class Artwork implements ArtLibrary {
  readonly asked: string[] = [];
  async print(c: Card): Promise<ArtPrint | null> {
    this.asked.push(c.name);
    const crop = blank(160, 117, [0, 0, 0]);
    fillRect(crop, { cx: 80, cy: 58.5, width: 160, height: 117, angle: 0 }, artwork((c as Card & { art: number }).art));
    return artOfArtCrop(crop);
  }
}

/**
 * Reads what it's told to, but only from a name bar that's the right way up: the name bar is red, and the
 * left part of a strip the right way up is the red bar (upside down, it's the card's bottom: no red).
 */
class Reader implements TextReader {
  readonly lines: RgbaImage[] = [];
  pages = 0;
  constructor(
    private readonly name: string,
    private readonly page: string[] = [],
  ) {}
  async readLine(image: RgbaImage): Promise<string[]> {
    this.lines.push(image);
    return redness(image) > 0.15 ? [`f ${this.name} In`] : ['—— ~ |'];
  }
  async readPage(): Promise<string[]> {
    this.pages++;
    return this.page;
  }
}

function redness(image: RgbaImage): number {
  let red = 0;
  for (let i = 0; i < image.data.length; i += 4) {
    if (image.data[i]! > 150 && image.data[i + 1]! < 90) red++;
  }
  return red / (image.width * image.height);
}

const catalogPort: CardCatalog = { closest: async (texts) => catalog.closest(texts) };

/** A drawn card's corners (scaled around its middle), as fractions of the picture, clockwise from its top left. */
function cornersOf(
  card: { cx: number; cy: number; width: number; angle: number },
  scale: number,
  picture: RgbaImage,
): Quad {
  const height = (card.width * 88) / 63;
  const radians = (card.angle * Math.PI) / 180;
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([u, v]) => {
    const ox = (u! * card.width * scale) / 2;
    const oy = (v! * height * scale) / 2;
    return {
      x: (card.cx + Math.cos(radians) * ox - Math.sin(radians) * oy) / picture.width,
      y: (card.cy + Math.sin(radians) * ox + Math.cos(radians) * oy) / picture.height,
    };
  }) as unknown as Quad;
}

function tablePicture(art: number, angle = 4): RgbaImage {
  const picture = blank(320, 440, [52, 70, 58]);
  drawCard(picture, { cx: 160, cy: 220, width: 190, angle, art: artwork(art), nameBar: RED });
  addNoise(picture, 10);
  return picture;
}

describe('working out which card is in a close-up', () => {
  it('reads the name and compares the artwork with the deck: both agree, so it is sure', async () => {
    const art = new Artwork();
    const reader = new Reader('Rhystic Study');
    const result = await new CardIdentifier(reader, catalogPort, art).identify(tablePicture(1), { likely: deck });

    expect(result.guesses[0]!.card.name).toBe('Rhystic Study');
    expect(result.guesses[0]!.score).toBeGreaterThan(0.9);
    expect(result.picture).not.toBeNull();
    // The whole deck's artwork was compared.
    expect(art.asked).toEqual(expect.arrayContaining(deck.map((c) => c.name)));
  });

  it("goes by the artwork when the name can't be read", async () => {
    const result = await new CardIdentifier(new Reader('—'), catalogPort, new Artwork()).identify(tablePicture(3), {
      likely: deck,
    });
    expect(result.guesses[0]!.card.name).toBe('Cultivate');
  });

  it('goes by the name for a card not in the deck, or without a deck', async () => {
    const result = await new CardIdentifier(new Reader('Smothering Tithe'), catalogPort, new Artwork()).identify(
      tablePicture(7),
    );
    expect(result.guesses[0]!.card.name).toBe('Smothering Tithe');
    // Not Smother, whose name is in what was read, but as part of a longer word.
    expect(result.guesses.map((g) => g.card.name)).not.toContain('Smother');
  });

  it('reads an upside-down or tapped card the right way up', async () => {
    for (const angle of [180, 90, 270]) {
      const reader = new Reader('Rhystic Study');
      const result = await new CardIdentifier(reader, catalogPort, new Artwork()).identify(tablePicture(1, angle), {
        likely: deck,
      });
      expect(result.guesses[0]!.card.name, `${angle}°`).toBe('Rhystic Study');
      // The artwork told which way up it is, so the name was read right the first time.
      expect(reader.lines, `${angle}°`).toHaveLength(1);
      expect(reader.lines[0]!.width).toBeGreaterThan(reader.lines[0]!.height * 3);
    }
  });

  it("goes by where the video found the card, when its outline doesn't stand out from a busy background", async () => {
    // Bold stripes behind the card: their lines outnumber the card's, so on its own the card isn't found.
    const picture = blank(320, 440, [30, 30, 34]);
    for (let i = -20; i < 40; i++) {
      fillRect(picture, { cx: i * 28, cy: 220, width: 14, height: 900, angle: 30 }, [160, 160, 140]);
    }
    const placed = { cx: 160, cy: 220, width: 190, angle: 4 };
    drawCard(picture, { ...placed, art: artwork(1), nameBar: RED });
    addNoise(picture, 10);

    const alone = new Reader('Rhystic Study');
    const unhinted = await new CardIdentifier(alone, catalogPort, new Artwork()).identify(picture);
    expect(unhinted.picture).toBeNull();
    expect(alone.pages).toBe(1);

    // The outline from the video: a bit off, from a smaller and blurrier picture.
    const reader = new Reader('Rhystic Study');
    const result = await new CardIdentifier(reader, catalogPort, new Artwork()).identify(picture, {
      expected: cornersOf(placed, 0.95, picture),
    });
    expect(result.picture).not.toBeNull();
    expect(reader.pages).toBe(0);
    expect(result.guesses[0]!.card.name).toBe('Rhystic Study');
  });

  it('reads all the text when no card outline stands out', async () => {
    const table = blank(320, 440, [52, 70, 58]);
    addNoise(table, 30);
    const reader = new Reader('', ['blurry', 'Sol Ring', '—']);
    const result = await new CardIdentifier(reader, catalogPort, new Artwork()).identify(table, { likely: deck });
    expect(reader.pages).toBe(1);
    expect(result.picture).toBeNull();
    expect(result.guesses[0]!.card.name).toBe('Sol Ring');
  });

  it('offers each name once: tokens of the same name are one guess', async () => {
    const goblins = new CardIndex([
      card('Goblin', 9),
      { ...card('Goblin', 10), id: 'goblin-2' },
      { ...card('Goblin', 11), id: 'goblin-3' },
      card('Goblin Wardriver', 12),
    ]);
    const result = await new CardIdentifier(
      new Reader('', ['Goblin']),
      { closest: async (texts) => goblins.closest(texts) },
      new Artwork(),
    ).identify(blank(320, 440, [52, 70, 58]));
    expect(result.guesses.map((g) => g.card.name)).toEqual(['Goblin']);
  });

  it('says so when nothing fits', async () => {
    const table = blank(320, 440, [52, 70, 58]);
    const result = await new CardIdentifier(new Reader('', ['zzz']), catalogPort, new Artwork()).identify(table);
    expect(result.guesses).toEqual([]);
  });
});

describe('matching a name read off a card', () => {
  it.each([
    ['f Rhystic Study In', 'Rhystic Study', 0.95, 1],
    ['Rowe Study', 'Rhystic Study', 0.4, 0.75],
    ['Smothering Tithe', 'Smother', 0, 0.75],
    ['f Opt', 'Opt', 0.95, 1],
    ['Opt', 'Optimus', 0, 0.5],
    ['', 'Sol Ring', 0, 0],
  ])('%s → %s', (text, name, min, max) => {
    const similarity = nameSimilarity(text, name);
    expect(similarity).toBeGreaterThanOrEqual(min);
    expect(similarity).toBeLessThanOrEqual(max);
  });
});

// The gray conversion keeps the picture's shape when shrinking.
it('shrinks pictures by averaging', () => {
  const gray = toGray(blank(400, 200, [100, 100, 100]), 100);
  expect([gray.width, gray.height]).toEqual([100, 50]);
  expect(gray.data[0]).toBeCloseTo(100);
});
