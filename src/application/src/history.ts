import {
  applyEvent,
  comboThreats,
  isOut,
  lossReason,
  newGame,
  type GameState,
  type SeatIndex,
} from '@commander-brawl/domain';
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

/** Something worth retelling about a game. */
export type Moment =
  | {
      readonly kind: 'out';
      readonly turn: number;
      readonly seat: SeatIndex;
      readonly reason: OutReason;
      readonly by: SeatIndex | null;
    }
  /** A player's life went up or down a lot in one turn. */
  | { readonly kind: 'life'; readonly turn: number; readonly seat: SeatIndex; readonly amount: number }
  /** A player had every piece of a combo on the battlefield. */
  | { readonly kind: 'combo'; readonly turn: number; readonly seat: SeatIndex; readonly cards: readonly string[] };

const MOMENT_ORDER: Record<Moment['kind'], number> = { life: 0, combo: 1, out: 2 };

/** Life won or lost in one turn that's worth a mention. */
export const BIG_LIFE_SWING = 10;

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
  /** In the order they happened. Missing in records from before they were kept. */
  readonly moments?: readonly Moment[];
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
    noteLife(game, before, state);
    noteEliminations(game, before, state);
    noteCombos(game, state);
  }
  finish(game.endedAt, false);
  return records;
}

interface GameInProgress {
  readonly number: number;
  readonly startedAt: number;
  endedAt: number;
  readonly outs: Map<SeatIndex, NonNullable<RecordedPlayer['out']> & { order: number }>;
  moments: Moment[];
  /** Life won or lost this turn so far, by seat. */
  readonly swings: Map<SeatIndex, number>;
  swingTurn: number;
  /** Combos already completed (by seat and cards), so each is told once. */
  readonly combos: Set<string>;
}

function startGame(state: GameState, at: number): GameInProgress {
  return {
    number: state.number,
    startedAt: at,
    endedAt: at,
    outs: new Map(),
    moments: [],
    swings: new Map(),
    swingTurn: state.turn,
    combos: new Set(),
  };
}

function noteLife(game: GameInProgress, before: GameState, after: GameState): void {
  if (after.turn !== game.swingTurn) flushSwings(game);
  game.swingTurn = after.turn;
  after.seats.forEach((seat, index) => {
    const change = seat.life - (before.seats[index]?.life ?? seat.life);
    if (change !== 0) game.swings.set(index as SeatIndex, (game.swings.get(index as SeatIndex) ?? 0) + change);
  });
}

/** The turn is over: its big life swings are moments. */
function flushSwings(game: GameInProgress): void {
  for (const [seat, amount] of game.swings) {
    if (Math.abs(amount) >= BIG_LIFE_SWING) game.moments.push({ kind: 'life', turn: game.swingTurn, seat, amount });
  }
  game.swings.clear();
}

function noteCombos(game: GameInProgress, state: GameState): void {
  for (const threat of comboThreats(state)) {
    if (threat.missing.length > 0) continue;
    const key = `${threat.seat}:${threat.combo.cards.join('+')}`;
    if (game.combos.has(key)) continue;
    game.combos.add(key);
    game.moments.push({ kind: 'combo', turn: state.turn, seat: threat.seat, cards: threat.combo.cards });
  }
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
      const reason = loss?.kind ?? 'conceded';
      game.outs.set(seat, { turn: after.turn, reason, by, order: game.outs.size });
      game.moments.push({ kind: 'out', turn: after.turn, seat, reason, by });
    } else if (!nowOut && wasOut) {
      // Back in (they said they're still in, or a change was taken back).
      game.outs.delete(seat);
      game.moments = game.moments.filter((m) => !(m.kind === 'out' && m.seat === seat));
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
  flushSwings(game);
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
    // Within a turn, what happened (life, combos) before who went out because of it.
    moments: [...game.moments]
      .filter((m) => seated.includes(m.seat))
      .sort((a, b) => a.turn - b.turn || MOMENT_ORDER[a.kind] - MOMENT_ORDER[b.kind]),
  };
}

/** The recap of a game as text, for Discord or a file. */
export function recapText(record: GameRecord, number?: number): string {
  const nameAt = (seat: SeatIndex | null) =>
    seat === null ? null : (record.players.find((p) => p.seat === seat)?.name ?? `Seat ${seat + 1}`);
  const minutes = Math.round((record.endedAt - record.startedAt) / 60_000);
  const lines = [`**${number ? `Game ${number} recap` : 'Game recap'}** · ${turns(record.turns)} · ${minutes} min`];
  const standings = [...record.players].sort((a, b) => (a.place ?? 9) - (b.place ?? 9));
  standings.forEach((p, i) => {
    const deck = [p.commanders.join(' & '), p.deck].filter(Boolean).join(', ');
    const how = p.out
      ? `out on turn ${p.out.turn}, ${OUT_WORDS[p.out.reason]}${p.out.by !== null ? ` (${nameAt(p.out.by)})` : ''}`
      : record.winner === p.seat
        ? 'winner'
        : 'still in';
    lines.push(`${p.place ?? i + 1}. ${p.name}${deck ? ` (${deck})` : ''}: ${how}`);
  });
  const moments = record.moments ?? [];
  if (moments.length > 0) {
    lines.push('', 'Key moments:');
    for (const moment of moments) lines.push(`- Turn ${moment.turn}: ${describeMoment(moment, nameAt)}`);
  }
  return lines.join('\n');
}

/** "1 turn", "7 turns". */
export function turns(count: number): string {
  return `${count} turn${count === 1 ? '' : 's'}`;
}

const OUT_WORDS: Record<OutReason, string> = {
  life: 'no life left',
  poison: 'poison',
  'commander-damage': 'commander damage',
  'custom-counter': 'a counter',
  conceded: 'conceded',
};

export function describeMoment(moment: Moment, nameAt: (seat: SeatIndex | null) => string | null): string {
  const who = nameAt(moment.seat);
  switch (moment.kind) {
    case 'out':
      return moment.by !== null
        ? `${nameAt(moment.by)} knocked out ${who} (${OUT_WORDS[moment.reason]})`
        : `${who} was out (${OUT_WORDS[moment.reason]})`;
    case 'life':
      return moment.amount > 0 ? `${who} gained ${moment.amount} life` : `${who} lost ${-moment.amount} life`;
    case 'combo':
      return `${who} had a whole combo: ${moment.cards.join(' + ')}`;
  }
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

/** Reads untrusted data (an imported file) as game records, leaving out any that aren't, and any odd moments. */
export function toGameRecords(raw: unknown): GameRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isGameRecord).map((record) => {
    const moments: unknown = record.moments;
    if (moments === undefined) return record;
    return { ...record, moments: Array.isArray(moments) ? moments.filter(isMoment) : [] };
  });
}

function isMoment(value: unknown): value is Moment {
  if (typeof value !== 'object' || value === null) return false;
  const m = value as Record<string, unknown>;
  const isSeat = (s: unknown) => s === 0 || s === 1 || s === 2 || s === 3;
  if (typeof m.turn !== 'number' || !isSeat(m.seat)) return false;
  switch (m.kind) {
    case 'out':
      return typeof m.reason === 'string' && m.reason in OUT_WORDS && (m.by === null || isSeat(m.by));
    case 'life':
      return typeof m.amount === 'number';
    case 'combo':
      return (
        Array.isArray(m.cards) && m.cards.length <= 10 && m.cards.every((c) => typeof c === 'string' && c.length <= 160)
      );
    default:
      return false;
  }
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
