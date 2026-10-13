import { normalizeCardName, type Card } from '@commander-brawl/domain';

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

  constructor(cards: readonly Card[]) {
    this.entries = cards.map((card) => {
      const names = [...new Set([card.name, ...card.faces.map((f) => f.name)].map(normalizeCardName))];
      return { card, names, words: [...new Set(names.flatMap((n) => n.split(' ')))] };
    });
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

  /**
   * The card with exactly this name, the way it'd be written in a deck list: case, accents and
   * punctuation don't matter, and the front face's name is enough for double-faced cards.
   */
  byName(name: string): Card | undefined {
    return this.byNormalizedName.get(normalizeCardName(name));
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
