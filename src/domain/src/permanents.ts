/** A spot on a player's camera picture: fractions of its width and height (0 to 1), from the top left. */
export interface Spot {
  readonly x: number;
  readonly y: number;
}

/**
 * Permanents a player wants the table to keep track of: a card with counters on it, or a group of tokens
 * (how many, how many tapped). Usually where it is on their video too, to show it there.
 */
export interface Permanent {
  /** Made up by the player who adds it. */
  readonly id: string;
  readonly name: string;
  /** The card, when it's known, for its picture and text. */
  readonly cardId: string | null;
  readonly token: boolean;
  /** How many: tokens come in groups; a card is one. */
  readonly count: number;
  /** How many of them are tapped. */
  readonly tapped: number;
  /** Counters on it (on each of them, for a group of tokens), by kind: "+1/+1", "loyalty", a custom counter's id. */
  readonly counters: Readonly<Record<string, number>>;
  /** Where it is on its player's camera picture. Null: only in the list. */
  readonly spot: Spot | null;
}

/** The counters that come up most, offered first. */
export const PERMANENT_COUNTERS = [
  '+1/+1',
  '-1/-1',
  'loyalty',
  'shield',
  'stun',
  'charge',
  'lore',
  'oil',
  'time',
  'finality',
] as const;

export const MAX_PERMANENTS = 60;
export const MAX_TOKENS_IN_GROUP = 999;
export const MAX_COUNTER_KINDS = 12;
export const MAX_COUNTER_KIND_LENGTH = 40;

/** What a player gives when adding a permanent: the rest starts empty. */
export interface NewPermanent {
  readonly id: string;
  readonly name: string;
  readonly cardId: string | null;
  readonly token: boolean;
  readonly count: number;
  /** Where it is on the player's video (earlier versions didn't say). */
  readonly spot?: Spot | null;
}

/** Reads untrusted data as a spot on a picture. Null if it isn't one. */
export function toSpot(raw: unknown): Spot | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { x, y } = raw as Record<string, unknown>;
  const fraction = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
  return fraction(x) && fraction(y) ? { x, y } : null;
}

export function toNewPermanent(raw: unknown): NewPermanent | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { id, name, cardId, token, count } = raw as Record<string, unknown>;
  const rawSpot = (raw as Record<string, unknown>).spot;
  const spot = rawSpot === undefined || rawSpot === null ? null : toSpot(rawSpot);
  if (rawSpot !== undefined && rawSpot !== null && spot === null) return null;
  const valid =
    typeof id === 'string' &&
    id.length > 0 &&
    id.length <= 64 &&
    typeof name === 'string' &&
    name.trim().length > 0 &&
    name.length <= 160 &&
    (cardId === null || (typeof cardId === 'string' && cardId.length > 0 && cardId.length <= 64)) &&
    typeof token === 'boolean' &&
    typeof count === 'number' &&
    Number.isInteger(count) &&
    count >= 1 &&
    count <= (token ? MAX_TOKENS_IN_GROUP : 1);
  if (!valid) return null;
  return spot ? { id, name: name.trim(), cardId, token, count, spot } : { id, name: name.trim(), cardId, token, count };
}

export function isCounterKind(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_COUNTER_KIND_LENGTH;
}

export function addPermanent(permanents: readonly Permanent[], added: NewPermanent): readonly Permanent[] {
  if (permanents.length >= MAX_PERMANENTS || permanents.some((p) => p.id === added.id)) return permanents;
  return [...permanents, { ...added, spot: added.spot ?? null, tapped: 0, counters: {} }];
}

/** It's another card than was thought (a close-up's guess put right). A card is one of it; a token keeps its count. */
export function identify(permanent: Permanent, name: string, cardId: string | null, token: boolean): Permanent {
  const count = token ? permanent.count : 1;
  return { ...permanent, name, cardId, token, count, tapped: Math.min(permanent.tapped, count) };
}

/**
 * A counter or a note put on a spot of a player's battlefield, on their video, but not on a card the app knows
 * about (yet). Connected to a card, a counter becomes that card's.
 */
export interface PlacedMarker {
  readonly id: string;
  readonly spot: Spot;
  /** A counter's kind ("+1/+1", "loyalty", a custom counter's), or NOTE. */
  readonly kind: string;
  /** How many, for a counter. */
  readonly count: number;
  /** A note's words: "Attacking", "Goaded by Alex". */
  readonly text: string;
}

export const NOTE = 'note';
export const MAX_MARKERS = 40;
export const MAX_MARKER_COUNT = 999;
export const MAX_NOTE_LENGTH = 40;

export function toPlacedMarker(raw: unknown): PlacedMarker | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { id, spot, kind, count, text } = raw as Record<string, unknown>;
  const at = toSpot(spot);
  const valid =
    typeof id === 'string' &&
    id.length > 0 &&
    id.length <= 64 &&
    at !== null &&
    isCounterKind(kind) &&
    typeof count === 'number' &&
    Number.isInteger(count) &&
    count >= (kind === NOTE ? 0 : 1) &&
    count <= MAX_MARKER_COUNT &&
    typeof text === 'string' &&
    text.length <= MAX_NOTE_LENGTH &&
    (kind !== NOTE || text.trim().length > 0);
  return valid ? { id, spot: at, kind, count, text: text.trim() } : null;
}

export function placeMarker(markers: readonly PlacedMarker[], marker: PlacedMarker): readonly PlacedMarker[] {
  if (markers.length >= MAX_MARKERS || markers.some((m) => m.id === marker.id)) return markers;
  return [...markers, marker];
}

/** More or fewer of a counter. None left and it's gone. Notes don't count. */
export function changeMarkers(markers: readonly PlacedMarker[], id: string, amount: number): readonly PlacedMarker[] {
  return markers.flatMap((m) => {
    if (m.id !== id || m.kind === NOTE) return [m];
    const count = Math.min(MAX_MARKER_COUNT, m.count + amount);
    return count <= 0 ? [] : [{ ...m, count }];
  });
}

export function changePermanent(
  permanents: readonly Permanent[],
  id: string,
  change: (permanent: Permanent) => Permanent,
): readonly Permanent[] {
  return permanents.some((p) => p.id === id) ? permanents.map((p) => (p.id === id ? change(p) : p)) : permanents;
}

/** More or fewer tokens in a group: at least one (removing the group is separate), no more tapped than there are. */
export function changeCount(permanent: Permanent, amount: number): Permanent {
  if (!permanent.token) return permanent;
  const count = Math.min(MAX_TOKENS_IN_GROUP, Math.max(1, permanent.count + amount));
  return { ...permanent, count, tapped: Math.min(permanent.tapped, count) };
}

/** Taps (or, negative, untaps) this many of them. */
export function changeTapped(permanent: Permanent, amount: number): Permanent {
  return { ...permanent, tapped: Math.min(permanent.count, Math.max(0, permanent.tapped + amount)) };
}

/** Adds (or removes) counters of a kind. None left of a kind and it's gone. */
export function changeCounter(permanent: Permanent, kind: string, amount: number): Permanent {
  const value = Math.max(0, (permanent.counters[kind] ?? 0) + amount);
  const { [kind]: _, ...others } = permanent.counters;
  if (value === 0) return { ...permanent, counters: others };
  if (!(kind in permanent.counters) && Object.keys(others).length >= MAX_COUNTER_KINDS) return permanent;
  return { ...permanent, counters: { ...others, [kind]: value } };
}

/** The untap step. */
export function untapAll(permanents: readonly Permanent[]): readonly Permanent[] {
  return permanents.some((p) => p.tapped > 0) ? permanents.map((p) => ({ ...p, tapped: 0 })) : permanents;
}
