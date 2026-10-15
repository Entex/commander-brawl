import type { Card } from '@commander-brawl/domain';

/** A token a card's text makes, or speaks of: its name, and its size and colors when the text says. */
export interface TokenSpec {
  /** "Goblin", "Treasure", "Zombie Army". */
  readonly name: string;
  /** "1/1". Null when the text doesn't say, or it's X/X. */
  readonly stats: string | null;
  /** Color letters ("W", "B"), none for colorless. Null when the text doesn't say. */
  readonly colors: readonly string[] | null;
}

const COLORS: ReadonlyMap<string, string> = new Map([
  ['white', 'W'],
  ['blue', 'U'],
  ['black', 'B'],
  ['red', 'R'],
  ['green', 'G'],
]);
/** Between a token's name and the word "token": "Goblin creature token", "Thopter artifact creature token". */
const TYPES = new Set(['creature', 'artifact', 'enchantment', 'land']);
/**
 * Capitalized before "token", but not part of a token's name: a sentence's first word ("Each creature token…", "Create
 * a…"), or how many ("create X Treasure tokens").
 */
const NOT_NAMES = new Set([
  'Create',
  'Creates',
  'Each',
  'Another',
  'Target',
  'That',
  'This',
  'Those',
  'All',
  'Any',
  'Other',
  'Up',
  'If',
  'X',
]);

/**
 * The tokens a card makes, from its text: "create a 1/1 red Goblin creature token", "create a Treasure token", and the
 * reminder text of keywords that make them (investigate makes a Clue, amass a Zombie Army). Each kind once.
 */
export function tokensMadeBy(card: Card): TokenSpec[] {
  const specs = new Map<string, TokenSpec>();
  const add = (spec: TokenSpec) => specs.set(`${spec.name}|${spec.stats}|${spec.colors?.join('')}`, spec);
  for (const text of [card.oracleText, ...card.faces.map((face) => face.oracleText)]) {
    // Sentences, and reminder text and quoted abilities on their own.
    for (const sentence of text.split(/[.;:()"“”\n]/)) {
      const words = sentence.split(/\s+/).map((word) => word.replace(/,$/, ''));
      words.forEach((word, i) => {
        if (word !== 'token' && word !== 'tokens') return;
        const spec = specBefore(words.slice(0, i));
        if (spec) add(spec);
      });
    }
    // A token with a name of its own: "create Marit Lage, a legendary 20/20 black Avatar…", "a token named Marit Lage".
    for (const [, name] of text.matchAll(/\bcreates? ([A-Z][\w'’-]*(?: [A-Z][\w'’-]*)*), an? /g)) {
      add({ name: name!, stats: null, colors: null });
    }
    for (const [, name] of text.matchAll(/\btokens? named ([A-Z][\w'’ -]*?)(?= with\b| that\b|[,.]|$)/g)) {
      add({ name: name!.trim(), stats: null, colors: null });
    }
  }
  return [...specs.values()];
}

/** The token the words before "token" describe, read backwards: "a 1/1 white and black Spirit creature". */
function specBefore(words: readonly string[]): TokenSpec | null {
  let i = words.length - 1;
  while (i >= 0 && TYPES.has(words[i]!)) i--;
  const name: string[] = [];
  while (i >= 0 && /^[A-Z][\w'’-]*$/.test(words[i]!) && !NOT_NAMES.has(words[i]!)) name.unshift(words[i--]!);
  if (name.length === 0) return null;
  const colors: string[] = [];
  let colorSaid = false;
  while (i >= 0 && (COLORS.has(words[i]!) || words[i] === 'colorless' || (words[i] === 'and' && colorSaid))) {
    const letter = COLORS.get(words[i]!);
    if (letter) colors.unshift(letter);
    colorSaid = true;
    i--;
  }
  const size = i >= 0 ? /^([\dX*]+)\/([\dX*]+)$/.exec(words[i]!) : null;
  const stats = size && !/[X*]/.test(size[0]) ? size[0] : null;
  return { name: name.join(' '), stats, colors: colorSaid ? colors : null };
}

/** Whether a card is a token (a token's own card in the card data, not a card that makes them). */
export function isTokenCard(card: Card): boolean {
  return card.layout === 'token' || card.layout === 'double_faced_token' || card.typeLine.startsWith('Token');
}
