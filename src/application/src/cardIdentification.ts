import { normalizeCardName, type Card } from '@commander-brawl/domain';
import { artOfCard, artSimilarity, type ArtPrint } from './artPrint';
import { CARD_RATIO, cardCorners, dominantTilt, findCard, locationOfCorners, type CardLocation } from './cardFinder';
import type { Quad } from './perspective';
import { extract, toGray, type RgbaImage } from './pixels';

/** Reads text in pictures (OCR). */
export interface TextReader {
  /** A strip with one line of text in it, such as a card's name bar. The ways it could be read. */
  readLine(image: RgbaImage): Promise<string[]>;
  /** All the text, line by line from the top. Text scattered among other things, like on a card, is fine. */
  readPage(image: RgbaImage): Promise<string[]>;
}

/** Every card there is. */
export interface CardCatalog {
  /** Cards whose names are closest to some text read off a card, best first. */
  closest(texts: readonly string[]): Promise<readonly NameMatch[]>;
}

export interface NameMatch {
  readonly card: Card;
  /** 0 to 1; see nameSimilarity. */
  readonly similarity: number;
}

/** The official pictures of cards' artwork. */
export interface ArtLibrary {
  /** Null when the picture can't be had (offline, or the card has none). */
  print(card: Card): Promise<ArtPrint | null>;
  /**
   * The card's other artwork: other printings (borderless, showcase, Secret Lair…), and what a player said was this
   * card in an earlier close-up. Asked for only when the usual artwork doesn't settle it.
   */
  alternatives?(card: Card): Promise<readonly ArtPrint[]>;
}

export interface CardGuess {
  readonly card: Card;
  /** How sure: 0 to 1. Above about 0.6 it's very likely this card. */
  readonly score: number;
}

export interface Identification {
  /** The card, cut out and straightened, if its outline was found. */
  readonly picture: RgbaImage | null;
  /** The likeliest cards, best first. Empty if nothing fits at all. */
  readonly guesses: readonly CardGuess[];
}

export interface IdentifyOptions {
  /** Cards the player is likely to have out: their deck. Compared by artwork too, and preferred. */
  readonly likely?: readonly Card[];
  /** The picture is shown turned this way; cards are tried that way up first. */
  readonly rotation?: 0 | 180;
  /**
   * Where the card's corners are thought to be, as fractions of the picture: found in the video before this
   * sharper picture was taken. The outline found in the picture itself is checked against it, and it stands
   * in when no outline stands out (a busy background behind the card).
   */
  readonly expected?: Quad;
}

/** Size of the straightened card the reading and comparing works on. */
const CARD_WIDTH = 480;
const CARD_HEIGHT = Math.round(CARD_WIDTH / CARD_RATIO);
/**
 * The card's name is in its top strip, left of the mana cost. Just the name bar first: with the border or the
 * top of the artwork in it, the reader often reads nothing at all. Then generous, in case the outline is off
 * (whether or not the border was found), and that without the frame's edge, which can throw the reader off too.
 */
const NAME_STRIPS = [
  { x: 0.04, y: 0.015, width: 0.7, height: 0.075 },
  { x: 0, y: 0, width: 0.8, height: 0.12 },
  { x: 0.05, y: 0, width: 0.75, height: 0.12 },
];
/** Letters about 25 pixels tall: what the reader reads best. */
const NAME_STRIP_WIDTH = 480;
/** How clearly a card's edges have to stand out to trust the outline. */
const MIN_CLARITY = 0.9;
/** Less, when it's where the card was expected (a busy background makes even a card's edges stand out less). */
const HINTED_MIN_CLARITY = 0.5;
/**
 * How much smaller or bigger than expected a found outline may be. Smaller: the expected outline is from a
 * blurrier video, may include the border, and a phone's photo can cover more than was asked for.
 */
const MIN_SIZE_OF_EXPECTED = 0.6;
const MAX_SIZE_OF_EXPECTED = 1.3;
/** How far from where it was expected a found outline's middle may be, as a share of the card's width. */
const AGREEMENT = 0.25;
const MAX_GUESSES = 5;
/**
 * Artwork this alike (or less) says nothing; 0.85 and up is usually the same artwork. Unrelated artwork can
 * score up to about 0.6 (both dark, say), so a match has to stand out from how alike the rest of the deck
 * looks too, when there's a deck to tell.
 */
const ART_FLOOR = 0.6;
const ART_FLOOR_MIN = 0.4;
/** Enough likely cards to tell how alike unrelated artwork looks in this picture. */
const ART_SAMPLE = 10;
/**
 * Name matches below this say nothing. Higher for the whole catalog than for the likely cards: among tens
 * of thousands of names, some name is always fairly close to any jumble of letters.
 */
const NAME_FLOOR = 0.5;
const CATALOG_NAME_FLOOR = 0.7;
/** How many of the best name matches also get their artwork compared. */
const ART_CHECKS = 4;
/** A name read this well needn't be read the other way up too. */
const GOOD_NAME = 0.8;
/** Artwork this alike is the card's own: it says which way up the card is, and that the other ways needn't be tried. */
const ART_DECIDES = 0.75;
/** A name read this well, one way up and not the other, says which way up the card is. */
const NAME_DECIDES = 0.65;
/** How much more upright one way has to look than the other for the card's frame to say which way up it is. */
const FRAME_DECIDES = 0.15;

/**
 * Works out which card is in a close-up: finds the card's outline, compares its artwork with the cards
 * the player is likely to have (their deck), and reads its name. The two together make for a confident
 * guess; either alone still gives some.
 */
export class CardIdentifier {
  constructor(
    private readonly reader: TextReader,
    private readonly catalog: CardCatalog,
    private readonly art: ArtLibrary,
  ) {}

  async identify(picture: RgbaImage, options: IdentifyOptions = {}): Promise<Identification> {
    const likely = options.likely ?? [];
    const found = locate(picture, options.expected);
    if (!found) {
      // No outline: read whatever text there is, and go by names alone.
      const upright =
        options.rotation === 180 ? extract(picture, 0, whole(picture), picture.width, picture.height, 2) : picture;
      const texts = readable(await this.reader.readPage(upright)).slice(0, 12);
      const names = texts.length > 0 ? await this.catalog.closest(texts) : [];
      return { picture: null, guesses: rank(likely, names, texts, new Map()) };
    }

    const turns = straightTurns(found, options.rotation ?? 0);
    const views = turns.map((t) => extract(picture, found.angle, found.rect, CARD_WIDTH, CARD_HEIGHT, t));
    const viewPrints = views.map((view) => artOfCard(view));
    const art = new Map<string, number>();
    const compare = (card: Card, print: ArtPrint) => {
      const similarities = viewPrints.map((viewPrint) => artSimilarity(viewPrint, print));
      art.set(card.id, Math.max(...similarities));
      return similarities;
    };

    // Artwork first: it's quick, works on blurry pictures, and tells which way up the card is.
    let artView = 0;
    let bestArt = -Infinity;
    const compareAll = async (cards: readonly Card[], prints: (card: Card) => Promise<readonly ArtPrint[]>) => {
      const found = await Promise.all(cards.map(prints));
      cards.forEach((card, i) => {
        for (const print of found[i]!) {
          const similarities = compare(card, print);
          // Kept at its most alike: the card's other artwork doesn't take back a match.
          art.set(card.id, Math.max(art.get(card.id) ?? -Infinity, ...similarities));
          similarities.forEach((similarity, v) => {
            if (similarity > bestArt) [bestArt, artView] = [similarity, v];
          });
        }
      });
    };
    const usual = async (card: Card) => {
      const print = await this.art.print(card);
      return print ? [print] : [];
    };
    await compareAll(likely, usual);
    // Not the usual artwork of any card in the deck: maybe another printing of one (alternative art).
    const alternatives = this.art.alternatives?.bind(this.art);
    if (bestArt < ART_DECIDES && alternatives && likely.length > 0) await compareAll(likely, alternatives);

    // Which way up the card is: the artwork tells, when it's clearly a likely card's. Otherwise the card's frame (the
    // text box is at the bottom) says which way to read the name first, and the name tells, if it reads one way up.
    const artDecides = bestArt >= ART_DECIDES;
    const frame = uprightness(views[0]!) - uprightness(views[1]!);
    const frameView = Math.abs(frame) >= FRAME_DECIDES ? (frame > 0 ? 0 : 1) : null;
    const first = artDecides ? artView : (frameView ?? artView);

    // Then the name, the likelier way up first, and the other only if that didn't read as a card. The
    // generous strip first, then just inside the card's frame: the frame's edge in the strip can throw the
    // reader off ("pr Study" for "Rhystic Study"), or the border may have been taken for the card's edge.
    const texts: string[] = [];
    let names: readonly NameMatch[] = [];
    let nameView: number | null = null;
    let nameScore = 0;
    reading: for (const v of [first, 1 - first]) {
      for (const strip of NAME_STRIPS) {
        texts.push(
          ...readable(await this.reader.readLine(cardPart(picture, found, turns[v]!, strip, NAME_STRIP_WIDTH))),
        );
        names = await this.catalog.closest(texts);
        const score = bestName(names, likely, texts);
        // Read better this way up than anything before: the name is this way up.
        if (score > nameScore + 0.05) [nameScore, nameView] = [score, v];
        if (score >= GOOD_NAME) break reading;
      }
    }

    // The artwork of the best name matches too, when they aren't among the likely cards; their other printings too,
    // if their usual artwork isn't this.
    const unchecked = names.slice(0, ART_CHECKS).filter((match) => !art.has(match.card.id));
    await compareAll(
      unchecked.map((match) => match.card),
      usual,
    );
    const named = names
      .slice(0, ART_CHECKS)
      .map((match) => match.card)
      .filter((card) => (art.get(card.id) ?? 0) < ART_DECIDES);
    if (alternatives && named.length > 0 && nameScore >= NAME_DECIDES) await compareAll(named, alternatives);

    const view = artDecides
      ? artView
      : nameView !== null && nameScore >= NAME_DECIDES
        ? nameView
        : bestArt >= ART_DECIDES
          ? artView
          : (frameView ?? artView);
    return { picture: views[view]!, guesses: rank(likely, names, texts, art) };
  }
}

/**
 * The card's outline in the picture. Without a hint, only one that stands out clearly. With where it's
 * expected (from the video), one that stands out less but agrees with that, or else the expected outline
 * itself: the video already found the card there.
 */
function locate(picture: RgbaImage, expected: Quad | undefined): CardLocation | null {
  if (!expected) {
    const location = findCard(picture);
    return location && location.clarity >= MIN_CLARITY ? location : null;
  }
  const { width, height } = picture;
  const corners = expected.map((c) => ({ x: c.x * width, y: c.y * height })) as unknown as Quad;
  const hint = locationOfCorners(corners, width, height, 0);
  const tilt = -dominantTilt(toGray(picture, 200));
  // Only a card lying the way the video showed it, about as big: not part of it (the text box lies like a
  // sideways card), nor something bigger around it.
  const short = Math.min(hint.rect.width, hint.rect.height);
  const location = findCard(picture, {
    point: centerOf(cardCorners(hint, width, height)),
    angles: Math.abs(tilt - hint.angle) < 1 ? [hint.angle] : [hint.angle, tilt],
    sideways: hint.sideways,
    minSize: (short * MIN_SIZE_OF_EXPECTED) / (Math.min(width, height) * CARD_RATIO),
  });
  return location && location.clarity >= HINTED_MIN_CLARITY && consistent(location, hint, width, height)
    ? location
    : hint;
}

/** Whether a found outline is where the card was expected, about as big (see MIN/MAX_SIZE_OF_EXPECTED). */
function consistent(location: CardLocation, hint: CardLocation, width: number, height: number): boolean {
  const short = Math.min(hint.rect.width, hint.rect.height);
  const size = Math.min(location.rect.width, location.rect.height) / short;
  const a = centerOf(cardCorners(location, width, height));
  const b = centerOf(cardCorners(hint, width, height));
  return (
    location.sideways === hint.sideways &&
    size >= MIN_SIZE_OF_EXPECTED &&
    size <= MAX_SIZE_OF_EXPECTED &&
    Math.hypot(a.x - b.x, a.y - b.y) <= short * AGREEMENT
  );
}

function centerOf(corners: Quad): { x: number; y: number } {
  return {
    x: corners.reduce((sum, c) => sum + c.x, 0) / corners.length,
    y: corners.reduce((sum, c) => sum + c.y, 0) / corners.length,
  };
}

/** Quarter turns that make the card upright: as shown first, then the other way up. */
function straightTurns(location: CardLocation, rotation: 0 | 180): [number, number] {
  const first = (location.sideways ? 1 : 0) + (rotation === 180 ? 2 : 0);
  return [first, first + 2];
}

/**
 * A part of the card (as shares of the upright card's width and height), straightened and cut from the
 * original picture at the given width, so text is as sharp as the picture allows.
 */
function cardPart(
  picture: RgbaImage,
  location: CardLocation,
  turns: number,
  area: { x: number; y: number; width: number; height: number },
  width: number,
): RgbaImage {
  // The area as it is on the card before the quarter turns.
  const x0 = area.x;
  const x1 = area.x + area.width;
  const y0 = area.y;
  const y1 = area.y + area.height;
  const [u0, u1, v0, v1] = [
    [x0, x1, y0, y1],
    [y0, y1, 1 - x1, 1 - x0],
    [1 - x1, 1 - x0, 1 - y1, 1 - y0],
    [1 - y1, 1 - y0, x0, x1],
  ][((turns % 4) + 4) % 4]!;
  const { rect } = location;
  const part = {
    x: rect.x + u0! * rect.width,
    y: rect.y + v0! * rect.height,
    width: (u1! - u0!) * rect.width,
    height: (v1! - v0!) * rect.height,
  };
  const height = Math.round((width * (area.height * CARD_HEIGHT)) / (area.width * CARD_WIDTH));
  return extract(picture, location.angle, part, width, height, turns);
}

/**
 * How much a straightened card looks the right way up, from its frame: the text box near the bottom is lighter and
 * greyer than the artwork near the top, and has lines of text in it. Positive: upright; negative: upside down.
 */
export function uprightness(view: RgbaImage): number {
  const bottom = bandLooks(view, 0.64, 0.9);
  const top = bandLooks(view, 0.1, 0.36);
  return (bottom.light - top.light) * 0.5 + (top.color - bottom.color) * 0.5 + (bottom.lines - top.lines) * 2;
}

/** A band across the card (between shares of its height), inside its frame: how light, how colorful, how lined. */
function bandLooks(view: RgbaImage, from: number, to: number): { light: number; color: number; lines: number } {
  const x0 = Math.floor(view.width * 0.1);
  const x1 = Math.ceil(view.width * 0.9);
  const y0 = Math.floor(view.height * from);
  const y1 = Math.ceil(view.height * to);
  let light = 0;
  let color = 0;
  const rows: number[] = [];
  for (let y = y0; y < y1; y++) {
    let row = 0;
    for (let x = x0; x < x1; x++) {
      const i = (y * view.width + x) * 4;
      const r = view.data[i]!;
      const g = view.data[i + 1]!;
      const b = view.data[i + 2]!;
      const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
      row += brightness;
      color += Math.max(r, g, b) - Math.min(r, g, b);
    }
    rows.push(row / (x1 - x0));
    light += row;
  }
  const pixels = (x1 - x0) * (y1 - y0);
  // Lines of text: row after row going light, dark, light. Their wiggle, not the slow change of a picture.
  let wiggle = 0;
  for (let k = 1; k < rows.length - 1; k++) wiggle += Math.abs(rows[k - 1]! - 2 * rows[k]! + rows[k + 1]!);
  return {
    light: light / pixels / 255,
    color: color / pixels / 255,
    lines: rows.length > 2 ? wiggle / (rows.length - 2) / 255 : 0,
  };
}

/** Lines with a few letters at least; the rest is the reader making out letters in lines and specks. */
function readable(lines: readonly string[]): string[] {
  return lines.filter((line) => normalizeCardName(line).replace(/ /g, '').length >= 3);
}

function rank(
  likely: readonly Card[],
  names: readonly NameMatch[],
  texts: readonly string[],
  art: ReadonlyMap<string, number>,
): CardGuess[] {
  const cards = new Map<string, Card>();
  for (const card of likely) cards.set(card.id, card);
  for (const match of names) if (!cards.has(match.card.id)) cards.set(match.card.id, match.card);
  const nameOf = new Map(names.map((match) => [match.card.id, match.similarity]));
  const likelyIds = new Set(likely.map((card) => card.id));

  const likelyArt = likely.map((card) => art.get(card.id)).filter((v) => v !== undefined);
  const artFloor = artFloorFor(likelyArt);
  const standout = standoutArt(likely, art);
  const guesses: CardGuess[] = [];
  for (const card of cards.values()) {
    const isLikely = likelyIds.has(card.id);
    const name = isLikely ? bestSimilarity(card, texts) : (nameOf.get(card.id) ?? 0);
    const floor = isLikely ? NAME_FLOOR : CATALOG_NAME_FLOOR;
    const fromName = name > floor ? (name - floor) / (1 - floor) : 0;
    const artLikeness = art.get(card.id) ?? 0;
    const fromArt = Math.max(
      artLikeness > artFloor ? Math.min(1, (1.5 * (artLikeness - artFloor)) / (1 - artFloor)) : 0,
      card.id === standout?.id ? Math.min(1, Math.max(0, (standout.margin - 0.05) / 0.2)) : 0,
    );
    // Either can make the case; both together make it strongly.
    let score = 1 - (1 - 0.9 * fromName) * (1 - 0.9 * fromArt);
    if (score > 0 && isLikely) score = Math.min(1, score + 0.05);
    if (score > 0.05) guesses.push({ card, score });
  }
  // One guess per name: tokens of the same name (a dozen "Goblin"s) are the same guess.
  const named = new Set<string>();
  return guesses
    .sort((a, b) => b.score - a.score || a.card.name.localeCompare(b.card.name))
    .filter((guess) => {
      const name = guess.card.name.toLowerCase();
      if (named.has(name)) return false;
      named.add(name);
      return true;
    })
    .slice(0, MAX_GUESSES);
}

/**
 * How alike artwork has to be to count, given how alike the likely cards' artwork is to the picture: well
 * above most of them (median plus a few deviations), since at most one or two can really be this card.
 */
function artFloorFor(similarities: readonly number[]): number {
  if (similarities.length < ART_SAMPLE) return ART_FLOOR;
  const sorted = [...similarities].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  const deviations = sorted.map((v) => Math.abs(v - median)).sort((a, b) => a - b);
  const spread = deviations[Math.floor(deviations.length / 2)]! * 1.4826;
  return Math.min(ART_FLOOR, Math.max(ART_FLOOR_MIN, median + 3 * spread));
}

/**
 * The likely card whose artwork is clearly more alike than any other's, and by how much. Some artwork is hard
 * to compare (dark, low contrast) and never looks very alike; standing out from the rest of the deck still
 * tells.
 */
function standoutArt(likely: readonly Card[], art: ReadonlyMap<string, number>): { id: string; margin: number } | null {
  const ranked = likely
    .flatMap((card) => {
      const likeness = art.get(card.id);
      return likeness === undefined ? [] : [{ id: card.id, likeness }];
    })
    .sort((a, b) => b.likeness - a.likeness);
  if (ranked.length < ART_SAMPLE || ranked[0]!.likeness < ART_FLOOR_MIN) return null;
  return { id: ranked[0]!.id, margin: ranked[0]!.likeness - ranked[1]!.likeness };
}

function bestName(names: readonly NameMatch[], likely: readonly Card[], texts: readonly string[]): number {
  let best = names[0]?.similarity ?? 0;
  for (const card of likely) best = Math.max(best, bestSimilarity(card, texts));
  return best;
}

function bestSimilarity(card: Card, texts: readonly string[]): number {
  let best = 0;
  for (const name of cardNames(card)) for (const text of texts) best = Math.max(best, nameSimilarity(text, name));
  return best;
}

/** A card's name, and its faces' names. */
export function cardNames(card: Card): string[] {
  return card.faces.length > 0 ? card.faces.map((face) => face.name) : [card.name];
}

/**
 * How well some text read off a card matches a card's name, from 0 to 1: how much of the name is in the
 * text, allowing for misread letters and junk around it ("f Rhystic Study In" is a perfect match). Short
 * names have to match the whole text, or they'd be found in any jumble of letters.
 */
export function nameSimilarity(text: string, name: string): number {
  return similarityOfNormalized(normalizeCardName(text), normalizeCardName(name));
}

/** nameSimilarity, for text and name already put through normalizeCardName. */
export function similarityOfNormalized(text: string, name: string): number {
  if (name.length === 0 || text.length === 0) return 0;
  if (name.length < 6) {
    // Without the odd letter misread from the card's frame at either end.
    const trimmed = text.replace(/^(\w )+|( \w)+$/g, '');
    return Math.max(0, 1 - levenshtein(name, trimmed) / Math.max(name.length, trimmed.length));
  }
  // At best the text's length out of the name's: not worth working out when that's already too little.
  if (text.length < name.length / 2) return 0;
  const { distance, end } = bestSubstring(name, text);
  const found = Math.max(0, 1 - distance / name.length);
  if (found < 0.5) return found;
  // A name that's part of a longer word ("Smother" in "Smothering Tithe") is a different card. One stray
  // letter is allowed: the reader often runs a speck on the frame into the name.
  const start = text.length - bestSubstring(reverse(name), reverse(text)).end;
  const inWord = lettersBefore(text, start) >= 2 || lettersAfter(text, end) >= 2;
  // And much more text than the name means the name isn't all of it.
  const unexplained = Math.max(0, text.length - name.length - 4) / text.length;
  return found * (inWord ? 0.7 : 1) * (1 - 0.5 * unexplained);
}

/** Fewest edits to turn the pattern into some part of the text, and where in the text that part ends. */
function bestSubstring(pattern: string, text: string): { distance: number; end: number } {
  let previous = new Array<number>(text.length + 1).fill(0);
  for (let i = 1; i <= pattern.length; i++) {
    const current = [i];
    for (let j = 1; j <= text.length; j++) {
      const cost = pattern[i - 1] === text[j - 1] ? 0 : 1;
      current.push(Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost));
    }
    previous = current;
  }
  let end = 0;
  for (let j = 1; j <= text.length; j++) if (previous[j]! < previous[end]!) end = j;
  return { distance: previous[end]!, end };
}

function lettersBefore(text: string, index: number): number {
  let count = 0;
  while (index - count - 1 >= 0 && text[index - count - 1] !== ' ') count++;
  return count;
}

function lettersAfter(text: string, index: number): number {
  let count = 0;
  while (index + count < text.length && text[index + count] !== ' ') count++;
  return count;
}

function reverse(text: string): string {
  return [...text].reverse().join('');
}

function levenshtein(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current.push(Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost));
    }
    previous = current;
  }
  return previous[b.length]!;
}

function whole(image: RgbaImage) {
  return { x: 0, y: 0, width: image.width, height: image.height };
}
