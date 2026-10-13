import type { LoggedEvent } from '@commander-brawl/application';
import type { GameState } from '@commander-brawl/domain';
import { commanderName, seatName, type Players } from './names';
import { formatChange } from './useGroupedChange';

/** One line for the game log, e.g. "Robin: Alex −3 life". */
export function describeEvent(entry: LoggedEvent, players: Players, game: GameState): string {
  const { event, by } = entry;
  switch (event.type) {
    case 'life-changed': {
      const target = seatName(players, event.seat);
      return target === by.name
        ? `${by.name} ${formatChange(event.amount)} life`
        : `${by.name}: ${target} ${formatChange(event.amount)} life`;
    }
    case 'commander-damage': {
      const target = seatName(players, event.to);
      const source = commanderName(game, players, event.from, event.commander);
      const who = target === by.name ? by.name : `${by.name}: ${target}`;
      return event.amount > 0
        ? `${who} took ${event.amount} commander damage from ${source}`
        : `${who} had ${-event.amount} commander damage from ${source} taken back`;
    }
    case 'commanders-named': {
      const target = seatName(players, event.seat);
      const names = event.names.filter((n) => n !== '');
      const list = names.length > 0 ? names.join(' and ') : 'unnamed';
      return `${by.name}: ${target}'s ${event.names.length > 1 ? 'commanders are' : 'commander is'} ${list}`;
    }
    case 'out-set': {
      const target = seatName(players, event.seat);
      if (event.out === true) return target === by.name ? `${by.name} is out` : `${by.name} marked ${target} as out`;
      if (event.out === false) return `${by.name}: ${target} is still in`;
      return `${by.name}: the rules decide whether ${target} is out again`;
    }
    case 'new-game':
      return `${by.name} started a new game`;
  }
}
