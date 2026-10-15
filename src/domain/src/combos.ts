import type { Combo } from './brackets';
import { normalizeCardName } from './cards';
import type { GameState } from './game';
import type { SeatIndex } from './table';

/** A combo from a player's deck that they have most of on the battlefield. */
export interface ComboThreat {
  readonly seat: SeatIndex;
  readonly combo: Combo;
  /** The combo's cards they have on the battlefield. */
  readonly present: readonly string[];
  readonly missing: readonly string[];
}

/**
 * Combos from the players' decks that they have all of, or all but one card of, on the battlefield (as kept
 * track of at the table). The most complete first.
 */
export function comboThreats(game: GameState): ComboThreat[] {
  const threats: ComboThreat[] = [];
  game.seats.forEach((seat, index) => {
    const combos = seat.deckAnalysis?.combos ?? seat.deckAnalysis?.twoCardCombos ?? [];
    if (combos.length === 0 || seat.permanents.length === 0) return;
    const onBattlefield = new Set(seat.permanents.flatMap((p) => names(p.name)));
    for (const combo of combos) {
      if (combo.cards.length < 2) continue;
      const present = combo.cards.filter((card) => names(card).some((n) => onBattlefield.has(n)));
      if (present.length === 0 || present.length < combo.cards.length - 1) continue;
      threats.push({
        seat: index as SeatIndex,
        combo,
        present,
        missing: combo.cards.filter((card) => !present.includes(card)),
      });
    }
  });
  return threats.sort(
    (a, b) => a.missing.length - b.missing.length || b.combo.cards.length - a.combo.cards.length || a.seat - b.seat,
  );
}

/** The combos in a player's deck that this card is part of, fewest cards first. */
export function combosWith(game: GameState, seat: SeatIndex, cardName: string): Combo[] {
  const analysis = game.seats[seat]?.deckAnalysis;
  const combos = analysis?.combos ?? analysis?.twoCardCombos ?? [];
  const card = new Set(names(cardName));
  return combos
    .filter((combo) => combo.cards.some((c) => names(c).some((n) => card.has(n))))
    .sort((a, b) => a.cards.length - b.cards.length);
}

/** Whether two ways of writing a card's name are the same card (a double-faced card by its front face too). */
export function sameCardName(a: string, b: string): boolean {
  const ofA = new Set(names(a));
  return names(b).some((n) => ofA.has(n));
}

/** The ways a card may be written: its whole name, and its front face's for a double-faced card. */
function names(name: string): string[] {
  const whole = normalizeCardName(name);
  const front = normalizeCardName(name.split(' // ')[0] ?? name);
  return whole === front ? [whole] : [whole, front];
}
