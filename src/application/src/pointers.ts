import { isSeatIndex, type SeatIndex } from '@commander-brawl/domain';
import type { TableSignaling, Unsubscribe } from './ports';

/** A point on a player's camera picture: whose, and where, as fractions of its width and height. */
export interface TablePoint {
  readonly seat: SeatIndex;
  readonly x: number;
  readonly y: number;
}

/** Pointing at something on the table, for everyone to see for a moment. */
export type Pointer =
  /** "This one." */
  | { readonly kind: 'ping'; readonly at: TablePoint }
  /** "This, at that": an attack, a target. */
  | { readonly kind: 'arrow'; readonly from: TablePoint; readonly to: TablePoint };

/**
 * Pings and arrows on players' videos. Sent straight to every other player, like the video connection
 * setup: they're for the moment, so they don't go in the game log.
 */
export class Pointers {
  private unsubscribe: Unsubscribe | null = null;
  private readonly listeners = new Set<(memberId: string, pointer: Pointer) => void>();

  constructor(
    private readonly signaling: TableSignaling,
    /** The other players at the table, by member id. */
    private readonly others: () => readonly string[],
  ) {}

  start(): void {
    this.unsubscribe ??= this.signaling.subscribe((event) => {
      if (event.type !== 'signal') return;
      const pointer = toPointer(event.data);
      if (pointer) for (const listener of this.listeners) listener(event.from, pointer);
    });
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.listeners.clear();
  }

  /** Other players pointing. */
  subscribe(listener: (memberId: string, pointer: Pointer) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  point(pointer: Pointer): void {
    for (const memberId of this.others()) this.signaling.send(memberId, { pointer });
  }
}

/** Reads untrusted data as a pointer. Null if it isn't one. */
export function toPointer(data: unknown): Pointer | null {
  if (typeof data !== 'object' || data === null || !('pointer' in data)) return null;
  const pointer = data.pointer as Record<string, unknown> | null;
  if (typeof pointer !== 'object' || pointer === null) return null;
  if (pointer.kind === 'ping') {
    const at = toTablePoint(pointer.at);
    return at ? { kind: 'ping', at } : null;
  }
  if (pointer.kind === 'arrow') {
    const from = toTablePoint(pointer.from);
    const to = toTablePoint(pointer.to);
    return from && to ? { kind: 'arrow', from, to } : null;
  }
  return null;
}

function toTablePoint(value: unknown): TablePoint | null {
  if (typeof value !== 'object' || value === null) return null;
  const { seat, x, y } = value as Record<string, unknown>;
  const fraction = (v: unknown): v is number => typeof v === 'number' && v >= 0 && v <= 1;
  return isSeatIndex(seat) && fraction(x) && fraction(y) ? { seat, x, y } : null;
}
