import type { SeatView } from '@commander-brawl/application';
import {
  POISON_LIMIT,
  type CommanderIndex,
  type GameState,
  type LossReason,
  type PlayerCounter,
  type SeatIndex,
} from '@commander-brawl/domain';

export type Players = readonly SeatView<unknown>[];

export const COUNTER_NAMES: Record<PlayerCounter, string> = {
  poison: 'Poison',
  energy: 'Energy',
  experience: 'Experience',
  rad: 'Rad',
  speed: 'Speed',
};

export function seatName(players: Players, seat: SeatIndex): string {
  return players.find((p) => p.player.seat === seat)?.player.name ?? `Seat ${seat + 1}`;
}

/** The commander's name if the player gave one, otherwise "Robin's commander" or "Robin's partner". */
export function commanderName(game: GameState, players: Players, seat: SeatIndex, commander: CommanderIndex): string {
  const name = game.seats[seat]?.commanders[commander];
  if (name) return name;
  return `${seatName(players, seat)}'s ${commander === 0 ? 'commander' : 'partner'}`;
}

export function describeLoss(reason: LossReason, game: GameState, players: Players): string {
  switch (reason.kind) {
    case 'life':
      return 'Out of life';
    case 'poison':
      return `${POISON_LIMIT} poison counters`;
    case 'commander-damage':
      return `21 commander damage from ${commanderName(game, players, reason.from, reason.commander)}`;
  }
}
