import type { SeatView } from '@commander-brawl/application';
import {
  POISON_LIMIT,
  type ClockSettings,
  type CommanderIndex,
  type GameState,
  type LossReason,
  type Phase,
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

/** Short names for the phase strip. */
export const PHASE_LABELS: Record<Phase, string> = {
  upkeep: 'Upkeep',
  draw: 'Draw',
  main1: 'Main',
  combat: 'Combat',
  attackers: 'Attackers',
  blockers: 'Blockers',
  damage: 'Damage',
  main2: 'Main 2',
  end: 'End',
};

/** For the game log: "moved to the draw step". */
export const PHASE_NAMES: Record<Phase, string> = {
  upkeep: 'the upkeep',
  draw: 'the draw step',
  main1: 'the first main phase',
  combat: 'combat',
  attackers: 'declare attackers',
  blockers: 'declare blockers',
  damage: 'combat damage',
  main2: 'the second main phase',
  end: 'the end step',
};

export function describeClock(settings: ClockSettings): string {
  return settings.kind === 'turn'
    ? `a turn timer, ${settings.minutes} min a turn`
    : `a chess clock, ${settings.minutes} min each`;
}

/** "4:05", or "-0:12" when the time is up. */
export function formatClock(ms: number): string {
  const seconds = Math.ceil(Math.abs(ms) / 1000);
  const text = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  return ms < 0 && seconds > 0 ? `-${text}` : text;
}

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
    case 'custom-counter':
      return `${reason.counter.name} reached ${reason.counter.loseAt}`;
  }
}
