/**
 * Permanents a player wants the table to keep track of: a card with counters on it, or a group of tokens
 * (how many, how many tapped).
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
}

export function toNewPermanent(raw: unknown): NewPermanent | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { id, name, cardId, token, count } = raw as Record<string, unknown>;
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
  return valid ? { id, name: name.trim(), cardId, token, count } : null;
}

export function isCounterKind(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_COUNTER_KIND_LENGTH;
}

export function addPermanent(permanents: readonly Permanent[], added: NewPermanent): readonly Permanent[] {
  if (permanents.length >= MAX_PERMANENTS || permanents.some((p) => p.id === added.id)) return permanents;
  return [...permanents, { ...added, tapped: 0, counters: {} }];
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
