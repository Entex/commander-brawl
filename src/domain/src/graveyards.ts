/**
 * A card in a player's graveyard, as far as the table knows: the ones someone put there. Never the whole graveyard,
 * but enough to look through without asking the player to fan it out on camera.
 */
export interface GraveCard {
  /** Made up by the player who put it there. */
  readonly id: string;
  readonly name: string;
  /** The card, when it's known, for its picture, text and type. */
  readonly cardId: string | null;
}

export const MAX_GRAVEYARD = 250;

export function toGraveCard(raw: unknown): GraveCard | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { id, name, cardId } = raw as Record<string, unknown>;
  const valid =
    typeof id === 'string' &&
    id.length > 0 &&
    id.length <= 64 &&
    typeof name === 'string' &&
    name.trim().length > 0 &&
    name.length <= 160 &&
    (cardId === null || (typeof cardId === 'string' && cardId.length > 0 && cardId.length <= 64));
  return valid ? { id, name: name.trim(), cardId } : null;
}

/** Put on top: the newest first, like the top of a real graveyard. */
export function bury(graveyard: readonly GraveCard[], card: GraveCard): readonly GraveCard[] {
  if (graveyard.length >= MAX_GRAVEYARD || graveyard.some((c) => c.id === card.id)) return graveyard;
  return [card, ...graveyard];
}
