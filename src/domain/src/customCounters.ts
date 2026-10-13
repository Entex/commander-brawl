/** Counters players make up themselves, for anything the built-in ones don't cover. */

export const MAX_CUSTOM_COUNTERS = 12;
export const MAX_CUSTOM_COUNTER_NAME_LENGTH = 24;
/** Limits for a counter's start, minimum, maximum and losing value. */
export const CUSTOM_COUNTER_RANGE = 999;

export const COUNTER_COLORS = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'gray'] as const;
export type CounterColor = (typeof COUNTER_COLORS)[number];

/** Each player has their own value, or there's one value for the whole table. */
/** Each player has one; the table has one; or it goes on cards (see Permanent). */
export type CounterScope = 'player' | 'table' | 'card';

export interface CustomCounter {
  readonly id: string;
  readonly name: string;
  readonly color: CounterColor;
  readonly scope: CounterScope;
  /** Where every new game starts it. */
  readonly start: number;
  readonly min: number | null;
  readonly max: number | null;
  /** A player whose counter reaches this value loses. Only for counters each player has. */
  readonly loseAt: number | null;
}

/** Where a new game starts this counter, kept within its limits. */
export function startValue(counter: CustomCounter): number {
  return clampToCounter(counter, counter.start);
}

export function clampToCounter(counter: CustomCounter, value: number): number {
  const low = counter.min ?? Number.NEGATIVE_INFINITY;
  const high = counter.max ?? Number.POSITIVE_INFINITY;
  return Math.min(high, Math.max(low, value));
}

export function counterValue(counter: CustomCounter, values: Readonly<Record<string, number>>): number {
  return values[counter.id] ?? startValue(counter);
}

/**
 * Whether the value has reached the losing value, coming from where the counter starts.
 * "Lose at 10" counts up to 10; "lose at 0" on a counter that starts at 20 counts down.
 */
export function hasReachedLoss(counter: CustomCounter, value: number): boolean {
  if (counter.loseAt === null || counter.scope !== 'player') return false;
  return counter.loseAt >= startValue(counter) ? value >= counter.loseAt : value <= counter.loseAt;
}

/** Reads untrusted data as a counter definition. Returns null if it isn't a valid one. */
export function toCustomCounter(raw: unknown): CustomCounter | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  const valid =
    typeof value.id === 'string' &&
    /^[A-Za-z0-9_-]{1,32}$/.test(value.id) &&
    name.length > 0 &&
    name.length <= MAX_CUSTOM_COUNTER_NAME_LENGTH &&
    (COUNTER_COLORS as readonly unknown[]).includes(value.color) &&
    (value.scope === 'player' || value.scope === 'table' || value.scope === 'card') &&
    isLimit(value.start) &&
    value.start !== null &&
    isLimit(value.min) &&
    isLimit(value.max) &&
    isLimit(value.loseAt) &&
    (value.min === null || value.max === null || (value.min as number) <= (value.max as number));
  if (!valid) return null;
  return {
    id: value.id as string,
    name,
    color: value.color as CounterColor,
    scope: value.scope as CounterScope,
    start: value.start as number,
    min: value.min as number | null,
    max: value.max as number | null,
    loseAt: value.scope === 'player' ? (value.loseAt as number | null) : null,
  };
}

function isLimit(value: unknown): value is number | null {
  return (
    value === null || (typeof value === 'number' && Number.isInteger(value) && Math.abs(value) <= CUSTOM_COUNTER_RANGE)
  );
}
