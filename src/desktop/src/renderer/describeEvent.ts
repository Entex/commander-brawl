import type { LoggedEvent, SeatView } from '@commander-brawl/application';

/** One line for the game log, e.g. "Robin: Alex −3 life". */
export function describeEvent(entry: LoggedEvent, seats: readonly SeatView<unknown>[]): string {
  const { event, by } = entry;
  switch (event.type) {
    case 'life-changed': {
      const target = seats.find((s) => s.player.seat === event.seat)?.player.name ?? `Seat ${event.seat + 1}`;
      const amount = event.amount > 0 ? `+${event.amount}` : `−${-event.amount}`;
      return target === by.name ? `${by.name} ${amount} life` : `${by.name}: ${target} ${amount} life`;
    }
    case 'new-game':
      return `${by.name} started a new game`;
  }
}
