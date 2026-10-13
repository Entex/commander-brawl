import { applyEvent, isOut, lossReason, newGame, type GameState, type SeatIndex } from '@commander-brawl/domain';
import { undoneIds, type LoggedEvent } from './gameLog';

/** How a player went out. */
export type OutReason = 'life' | 'poison' | 'commander-damage' | 'custom-counter' | 'conceded';

export interface RecordedPlayer {
  readonly seat: SeatIndex;
  readonly name: string;
  readonly deck: string | null;
  readonly commanders: readonly string[];
  /** 1 for the winner, then by how long they lasted. Null if the game ended before it was decided. */
  readonly place: number | null;
  readonly out: {
    readonly turn: number;
    readonly reason: OutReason;
    /** Who knocked them out: the commander's player for commander damage, else whose turn it was. */
    readonly by: SeatIndex | null;
  } | null;
}

/** A game that was played to the end (or until the table started a new one). */
export interface GameRecord {
  /** The table's log and the game's number in it: the same on every player's computer. */
  readonly id: string;
  /** On the host's clock, milliseconds since 1970. */
  readonly startedAt: number;
  readonly endedAt: number;
  readonly turns: number;
  readonly players: readonly RecordedPlayer[];
  readonly winner: SeatIndex | null;
}

/**
 * The games in a table's log, as records: each from its first event to the next new game, or to the end of
 * the log if it was decided. Only games that were played (with a turn order, or someone out) count. `name`
 * gives the name of the player at a seat, for seats nobody acted from.
 */
export function gamesInLog(
  entries: readonly LoggedEvent[],
  logId: string,
  name: (seat: SeatIndex) => string | null,
): GameRecord[] {
  const undone = undoneIds(entries);
  const records: GameRecord[] = [];
  let state = newGame();
  let game = startGame(state, entries[0]?.at ?? 0);
  const names = new Map<SeatIndex, string>();

  const finish = (at: number, final: boolean) => {
    const record = toRecord(game, state, logId, at, (seat) => names.get(seat) ?? name(seat));
    if (record && (final || record.winner !== null)) records.push(record);
  };

  for (const entry of entries) {
    names.set(entry.by.seat, entry.by.name);
    if (entry.event.type === 'undo' || undone.has(entry.id)) continue;
    if (entry.event.type === 'new-game') {
      // The game ended with its last event, not when someone got round to starting the next one.
      finish(game.endedAt, true);
      state = applyEvent(state, entry.event, entry.at);
      game = startGame(state, entry.at);
      continue;
    }
    const before = state;
    state = applyEvent(state, entry.event, entry.at);
    game.endedAt = entry.at;
    noteEliminations(game, before, state);
  }
  finish(game.endedAt, false);
  return records;
}

interface GameInProgress {
  readonly number: number;
  readonly startedAt: number;
  endedAt: number;
  readonly outs: Map<SeatIndex, NonNullable<RecordedPlayer['out']> & { order: number }>;
}

function startGame(state: GameState, at: number): GameInProgress {
  return { number: state.number, startedAt: at, endedAt: at, outs: new Map() };
}

function noteEliminations(game: GameInProgress, before: GameState, after: GameState): void {
  for (let index = 0; index < after.seats.length; index++) {
    const seat = index as SeatIndex;
    const wasOut = isOut(before, seat);
    const nowOut = isOut(after, seat);
    if (nowOut && !wasOut) {
      const loss = lossReason(after, seat);
      const by =
        loss?.kind === 'commander-damage'
          ? loss.from
          : loss && after.activeSeat !== null && after.activeSeat !== seat
            ? after.activeSeat
            : null;
      game.outs.set(seat, { turn: after.turn, reason: loss?.kind ?? 'conceded', by, order: game.outs.size });
    } else if (!nowOut && wasOut) {
      // Back in (they said they're still in, or a change was taken back).
      game.outs.delete(seat);
    }
  }
}

function toRecord(
  game: GameInProgress,
  state: GameState,
  logId: string,
  endedAt: number,
  name: (seat: SeatIndex) => string | null,
): GameRecord | null {
  const seated = (state.turnOrder ?? ([0, 1, 2, 3] as SeatIndex[])).filter((seat) => name(seat) !== null);
  if (seated.length < 2 || (state.turnOrder === null && game.outs.size === 0)) return null;
  const standing = seated.filter((seat) => !game.outs.has(seat));
  const winner = standing.length === 1 ? standing[0]! : null;
  // Later out is a better place.
  const outOrder = [...game.outs.entries()].sort((a, b) => b[1].order - a[1].order).map(([seat]) => seat);
  const players = seated.map((seat): RecordedPlayer => {
    const out = game.outs.get(seat);
    const place = winner === null ? null : seat === winner ? 1 : outOrder.indexOf(seat) + 2;
    return {
      seat,
      name: name(seat)!,
      deck: state.seats[seat]?.deck?.name ?? null,
      commanders: (state.seats[seat]?.commanders ?? []).filter((c) => c.length > 0),
      place,
      out: out ? { turn: out.turn, reason: out.reason, by: out.by } : null,
    };
  });
  return {
    id: `${logId}:${game.number}`,
    startedAt: game.startedAt,
    endedAt,
    turns: state.turn,
    players,
    winner,
  };
}

export interface PlayerStats {
  readonly name: string;
  readonly games: number;
  readonly wins: number;
  /** Average game length, in minutes, of their games. */
  readonly averageMinutes: number;
  /** Players they knocked out. */
  readonly eliminations: number;
  readonly commanderDamageKills: number;
}

export interface DeckStats {
  readonly deck: string;
  readonly player: string;
  readonly games: number;
  readonly wins: number;
}

export interface HistoryStats {
  readonly players: readonly PlayerStats[];
  readonly decks: readonly DeckStats[];
  /** Who knocked out whom, how many times: most first. */
  readonly eliminations: readonly { readonly by: string; readonly out: string; readonly times: number }[];
}

/** Win rates, game lengths and who knocked out whom, from finished games. Players go by name. */
export function historyStats(records: readonly GameRecord[]): HistoryStats {
  const players = new Map<
    string,
    { name: string; games: number; wins: number; minutes: number; kills: number; cmd: number }
  >();
  const decks = new Map<string, { deck: string; player: string; games: number; wins: number }>();
  const pairs = new Map<string, { by: string; out: string; times: number }>();
  const key = (name: string) => name.trim().toLowerCase();

  for (const record of records) {
    const minutes = Math.max(0, record.endedAt - record.startedAt) / 60_000;
    const nameAt = (seat: SeatIndex) => record.players.find((p) => p.seat === seat)?.name ?? null;
    for (const player of record.players) {
      const stats = players.get(key(player.name)) ?? {
        name: player.name,
        games: 0,
        wins: 0,
        minutes: 0,
        kills: 0,
        cmd: 0,
      };
      stats.games++;
      stats.minutes += minutes;
      if (record.winner === player.seat) stats.wins++;
      players.set(key(player.name), stats);
      if (player.deck) {
        const deckKey = `${key(player.name)}\n${player.deck}`;
        const deck = decks.get(deckKey) ?? { deck: player.deck, player: player.name, games: 0, wins: 0 };
        deck.games++;
        if (record.winner === player.seat) deck.wins++;
        decks.set(deckKey, deck);
      }
      const by = player.out?.by ?? null;
      const killer = by === null ? null : nameAt(by);
      if (killer) {
        const stats = players.get(key(killer)) ?? { name: killer, games: 0, wins: 0, minutes: 0, kills: 0, cmd: 0 };
        stats.kills++;
        if (player.out?.reason === 'commander-damage') stats.cmd++;
        players.set(key(killer), stats);
        const pairKey = `${key(killer)}\n${key(player.name)}`;
        const pair = pairs.get(pairKey) ?? { by: killer, out: player.name, times: 0 };
        pair.times++;
        pairs.set(pairKey, pair);
      }
    }
  }

  return {
    players: [...players.values()]
      .filter((p) => p.games > 0)
      .map((p) => ({
        name: p.name,
        games: p.games,
        wins: p.wins,
        averageMinutes: p.minutes / p.games,
        eliminations: p.kills,
        commanderDamageKills: p.cmd,
      }))
      .sort((a, b) => b.wins / b.games - a.wins / a.games || b.games - a.games || a.name.localeCompare(b.name)),
    decks: [...decks.values()].sort((a, b) => b.games - a.games || a.deck.localeCompare(b.deck)),
    eliminations: [...pairs.values()].sort((a, b) => b.times - a.times || a.by.localeCompare(b.by)),
  };
}

/** Reads untrusted data (an imported file) as game records, leaving out any that aren't. */
export function toGameRecords(raw: unknown): GameRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isGameRecord);
}

function isGameRecord(value: unknown): value is GameRecord {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  const isSeat = (s: unknown) => s === 0 || s === 1 || s === 2 || s === 3;
  return (
    typeof r.id === 'string' &&
    r.id.length > 0 &&
    r.id.length <= 200 &&
    typeof r.startedAt === 'number' &&
    typeof r.endedAt === 'number' &&
    typeof r.turns === 'number' &&
    (r.winner === null || isSeat(r.winner)) &&
    Array.isArray(r.players) &&
    r.players.length >= 2 &&
    r.players.length <= 4 &&
    r.players.every((p: Record<string, unknown> | null) => {
      if (typeof p !== 'object' || p === null) return false;
      const out = p.out as Record<string, unknown> | null;
      return (
        isSeat(p.seat) &&
        typeof p.name === 'string' &&
        p.name.length > 0 &&
        p.name.length <= 40 &&
        (p.deck === null || (typeof p.deck === 'string' && p.deck.length <= 80)) &&
        Array.isArray(p.commanders) &&
        p.commanders.every((c) => typeof c === 'string' && c.length <= 160) &&
        (p.place === null || typeof p.place === 'number') &&
        (out === null ||
          (typeof out === 'object' &&
            typeof out.turn === 'number' &&
            typeof out.reason === 'string' &&
            (out.by === null || isSeat(out.by))))
      );
    })
  );
}
