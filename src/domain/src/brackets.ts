/**
 * Commander brackets: players say how strong their deck is, from 1 (Exhibition) to 5 (cEDH), so the
 * table can agree on a fair game before it starts ("Rule 0"). This is information, not a referee.
 */

export type Bracket = 1 | 2 | 3 | 4 | 5;

export const BRACKET_NAMES: Record<Bracket, string> = {
  1: 'Exhibition',
  2: 'Core',
  3: 'Upgraded',
  4: 'Optimized',
  5: 'cEDH',
};

/** Bracket 3 allows a few Game Changers; 1 and 2 none. */
export const MAX_GAME_CHANGERS_IN_BRACKET_3 = 3;

export interface Combo {
  /** The cards it takes. */
  readonly cards: readonly string[];
  /** What it does, e.g. "Infinite mana", "Win the game". */
  readonly produces: readonly string[];
}

/** What's in a deck that matters for brackets. */
export interface DeckAnalysis {
  readonly gameChangers: readonly string[];
  readonly massLandDenial: readonly string[];
  readonly extraTurns: readonly string[];
  /** Combos of exactly two cards. */
  readonly twoCardCombos: readonly Combo[];
  /** False when the combo database couldn't be reached: then only Game Changers were checked. */
  readonly complete: boolean;
}

/** Where a deck goes beyond what its declared bracket usually allows. Empty means it fits. */
export function bracketConcerns(bracket: Bracket, analysis: DeckAnalysis): string[] {
  const concerns: string[] = [];
  const gameChangers = analysis.gameChangers.length;
  if (bracket <= 2 && gameChangers > 0) {
    concerns.push(`${countOf(gameChangers, 'Game Changer')} (brackets 1–2 have none): ${list(analysis.gameChangers)}`);
  }
  if (bracket === 3 && gameChangers > MAX_GAME_CHANGERS_IN_BRACKET_3) {
    concerns.push(
      `${countOf(gameChangers, 'Game Changer')} (bracket 3 allows ${MAX_GAME_CHANGERS_IN_BRACKET_3}): ${list(analysis.gameChangers)}`,
    );
  }
  if (bracket <= 3 && analysis.massLandDenial.length > 0) {
    concerns.push(`Mass land denial (brackets 1–3 avoid it): ${list(analysis.massLandDenial)}`);
  }
  if (bracket <= 3 && analysis.extraTurns.length > 0) {
    concerns.push(`Extra turns (brackets 1–3 don't chain them): ${list(analysis.extraTurns)}`);
  }
  if (bracket <= 3 && analysis.twoCardCombos.length > 0) {
    const combos = analysis.twoCardCombos.map((c) => c.cards.join(' + ')).join('; ');
    concerns.push(
      bracket === 3
        ? `Two-card combos (bracket 3 keeps them for late in the game): ${combos}`
        : `Two-card combos (brackets 1–2 have none): ${combos}`,
    );
  }
  return concerns;
}

export function isBracket(value: unknown): value is Bracket {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
}

/** Reads untrusted data as a deck analysis. Returns null if it isn't a valid one. */
export function toDeckAnalysis(raw: unknown): DeckAnalysis | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { gameChangers, massLandDenial, extraTurns, twoCardCombos, complete } = raw as Record<string, unknown>;
  if (!isNameList(gameChangers) || !isNameList(massLandDenial) || !isNameList(extraTurns)) return null;
  if (typeof complete !== 'boolean' || !Array.isArray(twoCardCombos) || twoCardCombos.length > 50) return null;
  const combos: Combo[] = [];
  for (const combo of twoCardCombos) {
    const { cards, produces } = (combo ?? {}) as Record<string, unknown>;
    if (!isNameList(cards) || !isNameList(produces)) return null;
    combos.push({ cards: [...cards], produces: [...produces] });
  }
  return {
    gameChangers: [...gameChangers],
    massLandDenial: [...massLandDenial],
    extraTurns: [...extraTurns],
    twoCardCombos: combos,
    complete,
  };
}

function isNameList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 100 &&
    value.every((v) => typeof v === 'string' && v.length > 0 && v.length <= 160)
  );
}

function countOf(count: number, thing: string): string {
  return `${count} ${thing}${count === 1 ? '' : 's'}`;
}

function list(names: readonly string[]): string {
  return names.join(', ');
}
