import { normalizeCardName, type Card } from '@commander-brawl/domain';
import { similarityOfNormalized } from './cardIdentification';
import { isTokenCard, type TokenSpec } from './tokens';

interface Entry {
  readonly card: Card;
  /** The full name and each face's name, normalized. */
  readonly names: readonly string[];
  readonly words: readonly string[];
}

const EXACT = 1000;
const STARTS_WITH = 800;
const WORD_STARTS = 600;
const CONTAINS = 400;
const TYPO = 200;
/** Tokens, emblems and the like come after real cards with an equally good match. */
const EXTRA_PENALTY = 50;
const EXTRAS = new Set(['token', 'double_faced_token', 'emblem', 'planar', 'scheme']);

/** All the cards, searchable the way players type: partial words, any case, no accents, a typo or two. */
export class CardIndex {
  private readonly entries: Entry[];
  private readonly byId = new Map<string, Card>();
  private readonly byNormalizedName = new Map<string, Card>();
  /** Every distinct word in a card name, and the cards that have it. Typo search works on words. */
  private readonly entriesByWord = new Map<string, Entry[]>();
  /** Every pair of neighboring letters in a card name, and the cards (by position) that have it. Made when first needed. */
  private byPair: Map<string, number[]> | null = null;
  /** For each card, how many pairs a text needs in common with its names to be compared with them. */
  private pairsNeeded: number[] = [];
  /** The tokens, by their whole names, and by their faces' names. Made when first needed. */
  private tokensByName: { readonly whole: Map<string, Card[]>; readonly faces: Map<string, Card[]> } | null = null;

  constructor(cards: readonly Card[]) {
    this.entries = cards.map((card) => {
      const names = [...new Set([card.name, ...card.faces.map((f) => f.name)].map(normalizeCardName))];
      return { card, names, words: [...new Set(names.flatMap((n) => n.split(' ')))] };
    });
    // A card's full name wins over another card's face of the same name ("Blood" is the token, not the
    // back of Flesh // Blood).
    for (const entry of this.entries) {
      const name = entry.names[0]!;
      if (!this.byNormalizedName.has(name)) this.byNormalizedName.set(name, entry.card);
    }
    for (const entry of this.entries) {
      this.byId.set(entry.card.id, entry.card);
      for (const name of entry.names) if (!this.byNormalizedName.has(name)) this.byNormalizedName.set(name, entry.card);
      for (const word of entry.words) {
        const list = this.entriesByWord.get(word);
        if (list) list.push(entry);
        else this.entriesByWord.set(word, [entry]);
      }
    }
  }

  get size(): number {
    return this.entries.length;
  }

  get(id: string): Card | undefined {
    return this.byId.get(id);
  }

  /** Every card with this layout, by name: all the planes ('planar'), all the schemes ('scheme'). */
  withLayout(layout: string): Card[] {
    return this.entries
      .filter((entry) => entry.card.layout === layout)
      .map((entry) => entry.card)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * The tokens these say (see tokensMadeBy): by name (a token of just that name before one with it on a face, like
   * Treasure before Vampire // Treasure), of the size said, and of the colors said if any of them is. At most
   * `perKind` of each.
   */
  tokens(specs: readonly TokenSpec[], perKind = 6): Card[] {
    const { whole, faces } = (this.tokensByName ??= this.tokenIndex());
    const found = new Map<string, Card>();
    for (const spec of specs) {
      const name = normalizeCardName(spec.name);
      const named = whole.get(name) ?? faces.get(name) ?? [];
      const sized = spec.stats === null ? named : named.filter((card) => card.stats === spec.stats);
      const colors = spec.colors === null ? null : [...spec.colors].sort().join();
      const colored = sized.filter((card) => [...card.colorIdentity].sort().join() === colors);
      for (const card of (colored.length > 0 ? colored : sized).slice(0, perKind)) found.set(card.id, card);
    }
    return [...found.values()];
  }

  private tokenIndex(): { whole: Map<string, Card[]>; faces: Map<string, Card[]> } {
    const whole = new Map<string, Card[]>();
    const faces = new Map<string, Card[]>();
    const add = (index: Map<string, Card[]>, name: string, card: Card) => {
      const list = index.get(name);
      if (list) list.push(card);
      else index.set(name, [card]);
    };
    for (const entry of this.entries) {
      if (!isTokenCard(entry.card)) continue;
      const [name, ...faceNames] = entry.names;
      add(whole, name!, entry.card);
      for (const face of faceNames) add(faces, face, entry.card);
    }
    return { whole, faces };
  }

  /**
   * The card with exactly this name, the way it'd be written in a deck list: case, accents and
   * punctuation don't matter, and the front face's name is enough for double-faced cards.
   */
  byName(name: string): Card | undefined {
    return this.byNormalizedName.get(normalizeCardName(name));
  }

  /**
   * The cards whose names best match some text read off a card (see nameSimilarity): misread letters and
   * junk around the name are fine. Best first, at most `limit`, none below `floor`.
   */
  closest(texts: readonly string[], limit = 10, floor = 0.5): { card: Card; similarity: number }[] {
    const reads = [...new Set(texts.map(normalizeCardName))].filter((t) => t.length > 0);
    if (reads.length === 0) return [];
    const best = new Map<Entry, number>();
    for (const read of reads) {
      for (const entry of this.sharingLetters(read)) {
        let similarity = best.get(entry) ?? 0;
        entry.names.forEach((name, i) => {
          // A card with this full name before another card with a face of this name.
          const facePenalty = i === 0 ? 0 : 0.001;
          similarity = Math.max(similarity, similarityOfNormalized(read, name) - facePenalty);
        });
        best.set(entry, similarity);
      }
    }
    return (
      [...best]
        .filter(([, similarity]) => similarity > floor)
        // Real cards before tokens and the like that are named the same.
        .map(([entry, similarity]) => ({ card: entry.card, similarity: similarity - penalty(entry) / 10_000 }))
        .sort((a, b) => b.similarity - a.similarity || a.card.name.localeCompare(b.card.name))
        .slice(0, limit)
    );
  }

  /**
   * Cards whose names have a few letter pairs in common with the text: any name read well enough to match
   * does, and comparing only those is far quicker than comparing every name.
   */
  private sharingLetters(read: string): Entry[] {
    const index = (this.byPair ??= this.pairIndex());
    const shared = new Uint16Array(this.entries.length);
    const found: Entry[] = [];
    for (const pair of pairs(read)) {
      for (const i of index.get(pair) ?? []) {
        if (++shared[i]! === this.pairsNeeded[i]!) found.push(this.entries[i]!);
      }
    }
    return found;
  }

  private pairIndex(): Map<string, number[]> {
    const index = new Map<string, number[]>();
    this.pairsNeeded = this.entries.map((entry, i) => {
      let fewest = Infinity;
      const all = new Set<string>();
      for (const name of entry.names) {
        const own = pairs(name);
        fewest = Math.min(fewest, own.size);
        for (const pair of own) all.add(pair);
      }
      for (const pair of all) {
        const list = index.get(pair);
        if (list) list.push(i);
        else index.set(pair, [i]);
      }
      // A quarter of the name's pairs, and at least two (unless the name is that short): a badly read name
      // still has that many, and few other names do.
      return Math.min(fewest, Math.max(2, Math.round(fewest / 4)));
    });
    return index;
  }

  search(query: string, limit = 20): Card[] {
    const q = normalizeCardName(query);
    if (q === '') return [];
    const queryWords = q.split(' ');

    let scored = this.entries.flatMap((entry) => {
      const score = matchScore(entry, q, queryWords);
      return score > 0 ? [{ entry, score: score - penalty(entry) }] : [];
    });
    // Only look for typos when the plain matches don't fill the list; it's the slow part.
    if (scored.length < limit && q.length >= 4) {
      const found = new Set(scored.map((s) => s.entry));
      scored = scored.concat(this.typoMatches(queryWords).filter((s) => !found.has(s.entry)));
    }

    return scored
      .sort(
        (a, b) =>
          b.score - a.score ||
          a.entry.card.name.length - b.entry.card.name.length ||
          a.entry.card.name.localeCompare(b.entry.card.name),
      )
      .slice(0, limit)
      .map((s) => s.entry.card);
  }

  /**
   * Cards where every query word is close to a word of the name (or to the start of one), so
   * "rhystc stdy" finds Rhystic Study. Fewer typos score higher.
   */
  private typoMatches(queryWords: readonly string[]): { entry: Entry; score: number }[] {
    // Typos per card, for the cards that have matched every query word so far.
    let typos: Map<Entry, number> | undefined;
    for (const queryWord of queryWords) {
      const allowed = queryWord.length >= 8 ? 2 : queryWord.length >= 4 ? 1 : 0;
      const forWord = new Map<Entry, number>();
      for (const [word, entries] of this.entriesByWord) {
        const distance = word.startsWith(queryWord) ? 0 : wordDistance(queryWord, word, allowed);
        if (distance > allowed) continue;
        for (const entry of entries) {
          const before = typos === undefined ? 0 : typos.get(entry);
          if (before === undefined) continue;
          forWord.set(entry, Math.min(before + distance, forWord.get(entry) ?? Number.POSITIVE_INFINITY));
        }
      }
      if (forWord.size === 0) return [];
      typos = forWord;
    }
    return [...(typos ?? [])].map(([entry, count]) => ({ entry, score: TYPO - count - penalty(entry) }));
  }
}

/**
 * The pairs of neighboring characters in a normalized name or text. Pairs rather than longer runs: a name
 * read badly ("so rg" for "sol ring") still has some, and the artwork can confirm it.
 */
function pairs(text: string): Set<string> {
  const found = new Set<string>();
  if (text.length < 2) {
    found.add(text);
    return found;
  }
  for (let i = 0; i + 2 <= text.length; i++) found.add(text.slice(i, i + 2));
  return found;
}

function penalty(entry: Entry): number {
  return EXTRAS.has(entry.card.layout) ? EXTRA_PENALTY : 0;
}

function matchScore(entry: Entry, q: string, queryWords: readonly string[]): number {
  if (entry.names.includes(q)) return EXACT;
  if (entry.names.some((n) => n.startsWith(q))) return STARTS_WITH;
  if (queryWords.every((w) => entry.words.some((word) => word.startsWith(w)))) return WORD_STARTS;
  if (entry.names.some((n) => n.includes(q))) return CONTAINS;
  return 0;
}

/** Distance to the word, or to its start, so "rhystc" still finds "rhystic". */
function wordDistance(queryWord: string, word: string, max: number): number {
  const whole = editDistance(queryWord, word, max);
  return word.length > queryWord.length
    ? Math.min(whole, editDistance(queryWord, word.slice(0, queryWord.length), max))
    : whole;
}

/** Levenshtein distance, giving up (returning max + 1) as soon as it can't be within max. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
      current.push(value);
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > max) return max + 1;
    previous = current;
  }
  return previous[b.length]!;
}
