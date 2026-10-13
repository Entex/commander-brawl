import type { LoggedEvent } from '@commander-brawl/application';
import type { GameState } from '@commander-brawl/domain';
import { COUNTER_NAMES, commanderName, seatName, type Players } from './names';
import { formatChange } from './useGroupedChange';

/**
 * One line for the game log, e.g. "Robin: Alex −3 life".
 * `find` looks up other log entries, so an undo can say what it took back.
 */
export function describeEvent(
  entry: LoggedEvent,
  players: Players,
  game: GameState,
  find: (id: string) => LoggedEvent | undefined = () => undefined,
): string {
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
    case 'counter-changed': {
      const target = seatName(players, event.seat);
      const change = `${formatChange(event.amount)} ${COUNTER_NAMES[event.counter].toLowerCase()}`;
      return target === by.name ? `${by.name} ${change}` : `${by.name}: ${target} ${change}`;
    }
    case 'commander-cast': {
      const commander = commanderName(game, players, event.seat, event.commander);
      const target = seatName(players, event.seat);
      const who = target === by.name ? by.name : `${by.name}: ${target}`;
      return event.amount > 0 ? `${who} cast ${commander}` : `${who} took back a cast of ${commander}`;
    }
    case 'custom-counter-saved':
      return `${by.name} saved the counter ${event.counter.name}`;
    case 'custom-counter-removed': {
      const counter = game.customCounters.find((c) => c.id === event.id);
      return `${by.name} removed the counter ${counter?.name ?? ''}`.trimEnd();
    }
    case 'custom-counter-changed': {
      const name = game.customCounters.find((c) => c.id === event.id)?.name ?? 'a removed counter';
      if (event.seat === null) return `${by.name}: ${name} ${formatChange(event.amount)}`;
      const target = seatName(players, event.seat);
      const change = `${formatChange(event.amount)} ${name}`;
      return target === by.name ? `${by.name} ${change}` : `${by.name}: ${target} ${change}`;
    }
    case 'deck-chosen': {
      const target = seatName(players, event.seat);
      const who = target === by.name ? by.name : `${by.name}: ${target}`;
      return event.deck ? `${who} is playing ${event.deck.name}` : `${who} has no deck chosen`;
    }
    case 'deck-analyzed':
      return `${seatName(players, event.seat)}'s deck was checked for the bracket`;
    case 'bracket-declared': {
      const target = seatName(players, event.seat);
      const who = target === by.name ? by.name : `${by.name}: ${target}`;
      return event.bracket ? `${who} plays bracket ${event.bracket}` : `${who} has no bracket`;
    }
    case 'card-shown':
      return event.reason === 'cast' ? `${by.name} cast ${event.card.name}` : `${by.name} showed ${event.card.name}`;
    case 'turn-order-set':
      return `${by.name} shuffled the turn order: ${event.order.map((seat) => seatName(players, seat)).join(' → ')}`;
    case 'turn-passed': {
      const from = seatName(players, event.from);
      return from === by.name ? `${by.name} passed the turn` : `${by.name} passed the turn for ${from}`;
    }
    case 'new-game':
      return `${by.name} started a new game`;
    case 'undo': {
      const target = find(event.target);
      return target ? `${by.name} undid “${describeEvent(target, players, game)}”` : `${by.name} undid a change`;
    }
  }
}
