import { normalizeCardName, type Card } from '@commander-brawl/domain';
import { artOfCard, artSimilarity, type ArtPrint } from './artPrint';
import { CARD_RATIO, findCard, type CardLocation } from './cardFinder';
import { extract, type RgbaImage } from './pixels';

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
}

/** Size of the straightened card the reading and comparing works on. */
const CARD_WIDTH = 480;
const CARD_HEIGHT = Math.round(CARD_WIDTH / CARD_RATIO);
/** The card's name is in its top strip, left of the mana cost. Generous, whether or not the border was found. */
const NAME_STRIP = { x: 0, y: 0, width: 0.8, height: 0.12 };
/** Letters about 25 pixels tall: what the reader reads best. */
const NAME_STRIP_WIDTH = 480;
/** How clearly a card's edges have to stand out to trust the outline. */
const MIN_CLARITY = 0.9;
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
    const location = findCard(picture);
    const found = location && location.clarity >= MIN_CLARITY ? location : null;
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
    let bestView = 0;
    let bestArt = -Infinity;
    const likelyPrints = await Promise.all(likely.map((card) => this.art.print(card)));
    likely.forEach((card, i) => {
      const print = likelyPrints[i];
      if (!print) return;
      compare(card, print).forEach((similarity, v) => {
        if (similarity > bestArt) [bestArt, bestView] = [similarity, v];
      });
    });

    // Then the name, the likelier way up first, and the other only if that didn't read as a card.
    const texts: string[] = [];
    let names: readonly NameMatch[] = [];
    for (const v of [bestView, 1 - bestView]) {
      texts.push(
        ...readable(await this.reader.readLine(cardPart(picture, found, turns[v]!, NAME_STRIP, NAME_STRIP_WIDTH))),
      );
      names = await this.catalog.closest(texts);
      if (bestName(names, likely, texts) >= GOOD_NAME) break;
    }

    // The artwork of the best name matches too, when they aren't among the likely cards.
    const unchecked = names.slice(0, ART_CHECKS).filter((match) => !art.has(match.card.id));
    const prints = await Promise.all(unchecked.map((match) => this.art.print(match.card)));
    unchecked.forEach((match, i) => {
      const print = prints[i];
      if (print) compare(match.card, print);
    });

    return { picture: views[bestView]!, guesses: rank(likely, names, texts, art) };
  }
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
  return guesses.sort((a, b) => b.score - a.score || a.card.name.localeCompare(b.card.name)).slice(0, MAX_GUESSES);
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
