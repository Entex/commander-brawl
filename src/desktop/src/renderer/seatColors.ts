import type { SeatIndex } from '@commander-brawl/domain';

/**
 * Each seat's color, used wherever that player shows up: their seat's frame and name, their life total, their
 * pings and arrows, their lines in the log. The CSS has the same colors (.seat-color-0 to 3).
 */
export const SEAT_COLORS = ['#e5484d', '#f5c542', '#3d7ff5', '#34c27a'] as const;

/** The class that sets --seat, --seat-ink (text on the color) and --seat-soft (a tint) for a seat's player. */
export function seatColorClass(seat: SeatIndex | null | undefined): string {
  return seat === null || seat === undefined ? '' : `seat-color-${seat}`;
}
