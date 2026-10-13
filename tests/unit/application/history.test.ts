import { gamesInLog, historyStats, recapText, toGameRecords, type LoggedEvent } from '@commander-brawl/application';
import type { GameEvent, Player, SeatIndex } from '@commander-brawl/domain';
import { describe, expect, it } from 'vitest';

const alex: Player = { id: 'a', name: 'Alex', seat: 0 };
const robin: Player = { id: 'r', name: 'Robin', seat: 1 };
const sam: Player = { id: 's', name: 'Sam', seat: 2 };
const MIN = 60_000;

/** A log, one event a minute. */
function log(...steps: [Player, GameEvent][]): LoggedEvent[] {
  return steps.map(([by, event], seq) => ({ seq, id: `e${seq}`, at: seq * MIN, by, event }));
}
const names = (seat: SeatIndex) => ['Alex', 'Robin', 'Sam'][seat] ?? null;

describe('finished games', () => {
  const played = log(
    [
      alex,
      {
        type: 'deck-chosen',
        seat: 0,
        deck: { name: 'Atraxa Counters', commanders: [{ id: 'atraxa', name: 'Atraxa', count: 1 }], cards: [] },
      },
    ],
    [alex, { type: 'turn-order-set', order: [0, 1, 2] }],
    // On Alex's turn, Robin takes 21 from Atraxa.
    [alex, { type: 'commander-damage', from: 0, commander: 0, to: 1, amount: 21 }],
    [alex, { type: 'turn-passed', from: 0 }],
    // On Sam's turn (Robin is out, so Sam is next), Alex loses the rest of their life.
    [sam, { type: 'life-changed', seat: 0, amount: -40 }],
    [sam, { type: 'new-game', startingLife: 40 }],
    [alex, { type: 'life-changed', seat: 1, amount: -1 }],
  );

  it('are summed up from the log: standings, how each player went out, and who did it', () => {
    const [game, ...rest] = gamesInLog(played, 'table-1', names);
    expect(rest).toEqual([]);
    expect(game).toMatchObject({ id: 'table-1:1', startedAt: 0, endedAt: 4 * MIN, turns: 2, winner: 2 });
    expect(game!.players).toEqual([
      {
        seat: 0,
        name: 'Alex',
        deck: 'Atraxa Counters',
        commanders: ['Atraxa'],
        place: 2,
        out: { turn: 2, reason: 'life', by: 2 },
      },
      {
        seat: 1,
        name: 'Robin',
        deck: null,
        commanders: [],
        place: 3,
        out: { turn: 1, reason: 'commander-damage', by: 0 },
      },
      { seat: 2, name: 'Sam', deck: null, commanders: [], place: 1, out: null },
    ]);
  });

  it("leave out a game that's still going, or wasn't played", () => {
    expect(gamesInLog(played.slice(0, 4), 'table-1', names)).toEqual([]);
    expect(
      gamesInLog(
        log([alex, { type: 'life-changed', seat: 0, amount: -1 }], [alex, { type: 'new-game', startingLife: 40 }]),
        't',
        names,
      ),
    ).toEqual([]);
  });

  it("don't count what was taken back", () => {
    const undone = [
      ...played.slice(0, 3),
      { seq: 3, id: 'u', at: 3 * MIN, by: alex, event: { type: 'undo', target: 'e2' } } as LoggedEvent,
    ];
    expect(gamesInLog(undone, 't', names)).toEqual([]);
  });
});

describe('stats', () => {
  it('win rates, game lengths, and who knocked out whom', () => {
    const records = gamesInLog(
      [
        ...log(
          [alex, { type: 'turn-order-set', order: [0, 1] }],
          [alex, { type: 'commander-damage', from: 0, commander: 0, to: 1, amount: 21 }],
          [alex, { type: 'new-game', startingLife: 40 }],
        ),
      ],
      't',
      names,
    );
    const stats = historyStats([...records, ...records.map((r) => ({ ...r, id: `${r.id}-again` }))]);
    expect(stats.players).toEqual([
      { name: 'Alex', games: 2, wins: 2, averageMinutes: 1, eliminations: 2, commanderDamageKills: 2 },
      { name: 'Robin', games: 2, wins: 0, averageMinutes: 1, eliminations: 0, commanderDamageKills: 0 },
    ]);
    expect(stats.eliminations).toEqual([{ by: 'Alex', out: 'Robin', times: 2 }]);
  });

  it('reads imported records, leaving out anything that is not one', () => {
    const [record] = gamesInLog(
      log(
        [alex, { type: 'turn-order-set', order: [0, 1] }],
        [alex, { type: 'out-set', seat: 1, out: true }],
        [alex, { type: 'new-game', startingLife: 40 }],
      ),
      't',
      names,
    );
    expect(record!.players[1]!.out).toEqual({ turn: 1, reason: 'conceded', by: null });
    expect(toGameRecords([record, { id: 'x' }, null, 'nope'])).toEqual([record]);
    expect(toGameRecords({ not: 'a list' })).toEqual([]);
  });
});

describe('the recap', () => {
  it('has the standings, the big moments, and reads well as text', () => {
    const entries = log(
      [alex, { type: 'commanders-named', seat: 0, names: ['Atraxa'] }],
      [alex, { type: 'turn-order-set', order: [0, 1, 2] }],
      // A big turn for Alex: Robin takes 12 in one turn, in two hits.
      [alex, { type: 'life-changed', seat: 1, amount: -7 }],
      [alex, { type: 'life-changed', seat: 1, amount: -5 }],
      [alex, { type: 'life-changed', seat: 2, amount: -3 }],
      [alex, { type: 'turn-passed', from: 0 }],
      [robin, { type: 'out-set', seat: 2, out: true }],
      [robin, { type: 'commander-damage', from: 0, commander: 0, to: 1, amount: 21 }],
    );
    const [record] = gamesInLog(entries, 't', names);
    expect(record!.moments).toEqual([
      { kind: 'life', turn: 1, seat: 1, amount: -12 },
      { kind: 'life', turn: 2, seat: 1, amount: -21 },
      { kind: 'out', turn: 2, seat: 2, reason: 'conceded', by: null },
      { kind: 'out', turn: 2, seat: 1, reason: 'commander-damage', by: 0 },
    ]);
    expect(recapText(record!, 1)).toBe(
      [
        '**Game 1 recap** · 2 turns · 7 min',
        '1. Alex (Atraxa): winner',
        '2. Robin: out on turn 2, commander damage (Alex)',
        '3. Sam: out on turn 2, conceded',
        '',
        'Key moments:',
        '- Turn 1: Robin lost 12 life',
        '- Turn 2: Robin lost 21 life',
        '- Turn 2: Sam was out (conceded)',
        '- Turn 2: Alex knocked out Robin (commander damage)',
      ].join('\n'),
    );
  });

  it('drops odd moments from an imported file', () => {
    const [record] = gamesInLog(
      log([alex, { type: 'turn-order-set', order: [0, 1] }], [alex, { type: 'out-set', seat: 1, out: true }]),
      't',
      names,
    );
    const [read] = toGameRecords([{ ...record, moments: [...record!.moments!, { kind: 'meteor', turn: 1, seat: 0 }] }]);
    expect(read!.moments).toEqual(record!.moments);
  });
});
