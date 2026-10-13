import type { LoggedEvent } from '@commander-brawl/application';
import { DUNGEONS, type GameState, type SeatIndex } from '@commander-brawl/domain';
import {
  COUNTER_NAMES,
  PHASE_NAMES,
  commanderName,
  counterKindName,
  describeClock,
  seatName,
  type Players,
} from './names';
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
  // "Alex" when Alex did it to themselves, "Robin: Alex" when Robin did it for Alex.
  const who = (seat: SeatIndex) => {
    const target = seatName(players, seat);
    return target === by.name ? by.name : `${by.name}: ${target}`;
  };
  const byOther = (seat: SeatIndex) => (seatName(players, seat) === by.name ? '' : ` (${by.name})`);
  const permanentName = (seat: SeatIndex, id: string) =>
    game.seats[seat]?.permanents.find((p) => p.id === id)?.name ?? 'a permanent';
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
    case 'response-called':
      return `${by.name}: “Wait, I have a response!”`;
    case 'phase-set':
      return `${by.name} moved to ${PHASE_NAMES[event.phase]}`;
    case 'clock-set':
      return event.settings ? `${by.name} started ${describeClock(event.settings)}` : `${by.name} turned the clock off`;
    case 'clock-paused':
      return `${by.name} paused the clock`;
    case 'clock-resumed':
      return `${by.name} restarted the clock`;
    case 'monarch-set':
      return event.seat === null ? `${by.name}: nobody is the monarch` : `${who(event.seat)} became the monarch`;
    case 'initiative-taken':
      return event.seat === null ? `${by.name}: nobody has the initiative` : `${who(event.seat)} took the initiative`;
    case 'ventured': {
      const dungeon = DUNGEONS[event.to.dungeon];
      const room = dungeon.rooms[event.to.room]?.name ?? 'a room';
      return `${who(event.seat)} ventured into ${room} (${dungeon.name})`;
    }
    case 'ring-tempted':
      return event.amount > 0
        ? `The Ring tempted ${seatName(players, event.seat)}${byOther(event.seat)}`
        : `${by.name} took back the Ring tempting ${seatName(players, event.seat)}`;
    case 'citys-blessing-set':
      return `${who(event.seat)} ${event.has ? 'got' : 'lost'} the city's blessing`;
    case 'day-night-set':
      return event.value ? `${by.name}: it became ${event.value}` : `${by.name}: no more day and night`;
    case 'storm-changed':
      return `${by.name}: storm count ${formatChange(event.amount)}`;
    case 'dice-rolled':
    case 'coins-flipped':
    case 'seat-picked':
    case 'planar-die-rolled':
      return describeRoll(entry, players);
    case 'planechase-started':
      return `${by.name} started Planechase with ${event.deck.length} planes`;
    case 'planeswalked':
      return `${by.name} planeswalked to ${event.to.name}`;
    case 'planechase-ended':
      return `${by.name} ended Planechase`;
    case 'archenemy-started':
      return `${by.name} started Archenemy: ${seatName(players, event.seat)} is the archenemy`;
    case 'scheme-set-in-motion':
      return `${by.name} set ${event.scheme.name} in motion`;
    case 'scheme-abandoned': {
      const scheme = game.archenemy?.deck.find((s) => s.id === event.id);
      return `${by.name} abandoned ${scheme?.name ?? 'a scheme'}`;
    }
    case 'archenemy-ended':
      return `${by.name} ended Archenemy`;
    case 'permanent-added': {
      const { name, token, count } = event.permanent;
      return `${who(event.seat)} added ${token ? `${count} ${name} token${count === 1 ? '' : 's'}` : name}`;
    }
    case 'permanent-removed':
      return `${who(event.seat)} removed ${permanentName(event.seat, event.id)}`;
    case 'permanent-count-changed':
      return `${who(event.seat)}: ${permanentName(event.seat, event.id)} ${formatChange(event.amount)}`;
    case 'permanent-tapped':
      return `${who(event.seat)} ${event.amount > 0 ? 'tapped' : 'untapped'} ${permanentName(event.seat, event.id)}${
        Math.abs(event.amount) > 1 ? ` ×${Math.abs(event.amount)}` : ''
      }`;
    case 'permanent-counter-changed':
      return `${who(event.seat)}: ${permanentName(event.seat, event.id)} ${formatChange(event.amount)} ${counterKindName(
        game,
        event.kind,
      )}`;
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

/** "Robin rolled a d20: 17", "Robin flipped a coin: heads", "Robin picked a random opponent: Alex". */
export function describeRoll(entry: LoggedEvent, players: Players): string {
  const { event, by } = entry;
  switch (event.type) {
    case 'dice-rolled': {
      const dice = event.results.length === 1 ? `a d${event.sides}` : `${event.results.length}d${event.sides}`;
      const total = event.results.reduce((sum, r) => sum + r, 0);
      return event.results.length === 1
        ? `${by.name} rolled ${dice}: ${total}`
        : `${by.name} rolled ${dice}: ${event.results.join(', ')} (${total})`;
    }
    case 'coins-flipped':
      return event.results.length === 1
        ? `${by.name} flipped a coin: ${event.results[0]}`
        : `${by.name} flipped ${event.results.length} coins: ${event.results.join(', ')}`;
    case 'seat-picked': {
      const kind = event.seats.includes(by.seat) ? 'player' : 'opponent';
      return `${by.name} picked a random ${kind}: ${seatName(players, event.picked)}`;
    }
    case 'planar-die-rolled':
      return `${by.name} rolled the planar die: ${event.result === 'blank' ? 'nothing' : event.result}`;
    default:
      return '';
  }
}
