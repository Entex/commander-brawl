import type { SeatView } from '@commander-brawl/application';
import type { CommanderIndex, GameState, LossReason, SeatIndex } from '@commander-brawl/domain';

export type Players = readonly SeatView<unknown>[];

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
    case 'commander-damage':
      return `21 commander damage from ${commanderName(game, players, reason.from, reason.commander)}`;
  }
}
