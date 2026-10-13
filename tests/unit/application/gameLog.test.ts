import {
  GameSync,
  HostGameLog,
  replayLog,
  type AppendResult,
  type GameSyncMessage,
  type LogBatch,
  type LoggedEvent,
} from '@commander-brawl/application';
import type { GameEvent, Player } from '@commander-brawl/domain';
import { beforeEach, describe, expect, it } from 'vitest';

const alice: Player = { id: 'alice', name: 'Alice', seat: 0 };
const bob: Player = { id: 'bob', name: 'Bob', seat: 1 };
const hit = (seat: 0 | 1 | 2 | 3, amount: number): GameEvent => ({ type: 'life-changed', seat, amount });

const refused = { ok: false, reason: 'refused' };

/** The entry the host added, failing the test if it didn't add one. */
function added(result: AppendResult): LoggedEvent {
  if (!result.ok) throw new Error(`expected the host to add the event, but it was ${result.reason}`);
  return result.entry;
}

describe('HostGameLog', () => {
  let log: HostGameLog;

  beforeEach(() => {
    let time = 1_000;
    log = new HostGameLog('log-1', () => time++);
  });

  it('numbers events in the order they arrive and records who and when', () => {
    const first = added(log.append(alice, 'e1', hit(1, -3)));
    const second = added(log.append(bob, 'e2', hit(0, -2)));

    expect(first).toEqual({ seq: 0, id: 'e1', at: 1_000, by: alice, event: hit(1, -3) });
    expect(second.seq).toBe(1);
    expect(log.length).toBe(2);
  });

  it('ignores an event it already has, so a resend is harmless', () => {
    log.append(alice, 'e1', hit(1, -3));
    expect(log.append(alice, 'e1', hit(1, -3))).toEqual({ ok: false, reason: 'duplicate' });
    expect(log.length).toBe(1);
  });

  it('rolls the dice itself for actions that need chance', () => {
    const shuffled = new HostGameLog(
      'log-2',
      () => 0,
      () => 0.999,
    );
    const entry = added(shuffled.append(alice, 'e1', { type: 'randomize-turn-order', seats: [0, 1] }));
    expect(entry.event.type).toBe('turn-order-set');
  });

  it('lets players take back their own changes, once', () => {
    log.append(alice, 'e1', hit(1, -3));
    expect(added(log.append(alice, 'u1', { type: 'undo', target: 'e1' })).event).toEqual({
      type: 'undo',
      target: 'e1',
    });
    expect(log.append(alice, 'u2', { type: 'undo', target: 'e1' })).toEqual(refused);
  });

  it('does not let players take back someone else’s change, an undo, or something that never happened', () => {
    log.append(alice, 'e1', hit(1, -3));
    log.append(alice, 'u1', { type: 'undo', target: 'e1' });
    expect(log.append(bob, 'x1', { type: 'undo', target: 'e1' })).toEqual(refused);
    expect(log.append(alice, 'x2', { type: 'undo', target: 'u1' })).toEqual(refused);
    expect(log.append(alice, 'x3', { type: 'undo', target: 'nope' })).toEqual(refused);
    log.append(alice, 'e2', hit(0, -1));
    expect(log.append(bob, 'x4', { type: 'undo', target: 'e2' })).toEqual(refused);
    // Announcements change nothing, so there's nothing to take back.
    log.append(alice, 'r1', { type: 'response-called' });
    expect(log.append(alice, 'x5', { type: 'undo', target: 'r1' })).toEqual(refused);
  });

  it('continues a saved log under a new id, still knowing what it already has', () => {
    added(log.append(alice, 'e1', hit(1, -3)));
    added(log.append(alice, 'u1', { type: 'undo', target: 'e1' }));
    const restored = HostGameLog.restore('log-2', log.all(), () => 0);

    expect(restored.logId).toBe('log-2');
    expect(restored.length).toBe(2);
    expect(restored.append(alice, 'e1', hit(1, -3))).toEqual({ ok: false, reason: 'duplicate' });
    expect(restored.append(alice, 'u2', { type: 'undo', target: 'e1' })).toEqual(refused);
    expect(added(restored.append(bob, 'e2', hit(0, -1))).seq).toBe(2);
    // Players with the old log id get the whole log, and start over from the host's copy.
    expect(restored.batchFor('log-1', 2)).toMatchObject({ logId: 'log-2', from: 0 });
  });

  it('refuses invalid events', () => {
    expect(log.append(alice, 'e1', { type: 'life-changed', seat: 9, amount: 1 })).toEqual(refused);
    expect(log.length).toBe(0);
  });

  it('sends a returning player only what they missed', () => {
    for (let i = 0; i < 5; i++) log.append(alice, `e${i}`, hit(1, -1));
    const batch = log.batchFor('log-1', 3);
    expect(batch.from).toBe(3);
    expect(batch.events.map((e) => e.seq)).toEqual([3, 4]);
  });

  it('sends the whole log to a player who knows a different log or none', () => {
    log.append(alice, 'e1', hit(1, -1));
    log.append(alice, 'e2', hit(1, -1));
    expect(log.batchFor(null, 0).events).toHaveLength(2);
    expect(log.batchFor('another-table', 2)).toMatchObject({ from: 0, logId: 'log-1' });
  });
});

/** A player's GameSync talking to a HostGameLog, with a connection we can switch off. */
class Harness {
  readonly host = new HostGameLog('log-1', () => 0);
  readonly sent: GameSyncMessage[] = [];
  online = true;
  readonly sync: GameSync;
  private nextId = 0;

  constructor(private readonly player: Player = alice) {
    this.sync = new GameSync({ send: (message) => this.deliver(message) }, () => `${player.id}-${this.nextId++}`);
  }

  life(seat: number): number | undefined {
    return this.sync.getView().state.seats[seat]?.life;
  }

  /** Something another player did, as the host broadcasts it. */
  otherPlayer(id: string, event: GameEvent): LoggedEvent {
    return added(this.host.append(bob, id, event));
  }

  private deliver(message: GameSyncMessage): boolean {
    this.sent.push(message);
    if (!this.online) return false;
    if (message.kind === 'event') {
      const result = this.host.append(this.player, message.id, message.event);
      if (result.ok) this.sync.received({ logId: this.host.logId, from: result.entry.seq, events: [result.entry] });
      else if (result.reason === 'refused') this.sync.refused(message.id);
    } else {
      this.sync.received(this.host.batchFor(message.logId, message.from));
    }
    return true;
  }
}

describe('replayLog', () => {
  it('works out the game as if undone events never happened', () => {
    const entries = [
      { id: 'a', event: hit(0, -5) },
      { id: 'b', event: hit(0, -3) },
      { id: 'c', event: { type: 'undo', target: 'a' } as GameEvent },
    ];
    expect(replayLog(entries).seats[0]!.life).toBe(37);
  });

  it('can bring back a game that was reset by accident', () => {
    const entries = [
      { id: 'a', event: hit(2, -12) },
      { id: 'b', event: { type: 'new-game', startingLife: 40 } as GameEvent },
      { id: 'c', event: { type: 'undo', target: 'b' } as GameEvent },
    ];
    const state = replayLog(entries);
    expect(state.number).toBe(1);
    expect(state.seats[2]!.life).toBe(28);
  });
});

describe('GameSync', () => {
  it('keeps the last few events that arrived as they happened, but not ones caught up on', () => {
    const sync = new GameSync({ send: () => true }, () => 'x');
    const entry = (seq: number): LoggedEvent => ({
      seq,
      id: `e${seq}`,
      at: seq,
      by: alice,
      event: { type: 'response-called' },
    });
    // Catching up on what happened before.
    sync.received({ logId: 'log', from: 0, events: [entry(0), entry(1)] });
    expect(sync.getView().live).toEqual([]);
    // Then events as they happen.
    for (let seq = 2; seq < 14; seq++) sync.received({ logId: 'log', from: seq, events: [entry(seq)], live: true });
    const { live, lastLive } = sync.getView();
    expect(live.map((e) => e.seq)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(lastLive?.seq).toBe(13);

    // A different log (the host started over) starts with nothing live.
    sync.received({ logId: 'other', from: 0, events: [entry(0)] });
    expect(sync.getView()).toMatchObject({ live: [], lastLive: null });
  });

  it('shows your change at once and keeps it once the host confirms it', () => {
    const h = new Harness();
    h.sync.connected();
    h.sync.submit(hit(1, -4));
    expect(h.life(1)).toBe(36);
    expect(h.sync.getView()).toMatchObject({ unconfirmed: 0, logLength: 1 });
  });

  it('keeps changes made while offline and sends them when the connection is back', () => {
    const h = new Harness();
    h.online = false;
    h.sync.submit(hit(1, -4));
    h.sync.submit(hit(1, -1));

    expect(h.life(1)).toBe(35);
    expect(h.sync.getView().unconfirmed).toBe(2);

    h.online = true;
    h.sync.connected();
    expect(h.sync.getView()).toMatchObject({ unconfirmed: 0, logLength: 2 });
    expect(h.life(1)).toBe(35);
  });

  it('does not apply a change twice when the confirmation was lost and it is sent again', () => {
    const h = new Harness();
    const event = hit(1, -4);
    // The host got it, but the player never heard back.
    h.host.append(alice, 'alice-0', event);
    h.online = false;
    h.sync.submit(event);

    h.online = true;
    h.sync.connected();

    expect(h.host.length).toBe(1);
    expect(h.life(1)).toBe(36);
    expect(h.sync.getView().unconfirmed).toBe(0);
  });

  it('shows a shuffle only once the host has decided it', () => {
    const h = new Harness();
    h.online = false;
    h.sync.submit({ type: 'randomize-turn-order', seats: [0, 1] });
    expect(h.sync.getView().state.turnOrder).toBeNull();
    expect(h.sync.getView().unconfirmed).toBe(1);

    h.online = true;
    h.sync.connected();
    expect(h.sync.getView().state.turnOrder).toHaveLength(2);
  });

  it('takes back your own change at once and keeps it taken back once the host confirms', () => {
    const h = new Harness();
    h.sync.connected();
    h.sync.submit(hit(1, -4));
    const id = h.sync.getLog()[0]!.id;
    h.online = false;
    h.sync.submit({ type: 'undo', target: id });
    expect(h.life(1)).toBe(40);

    h.online = true;
    h.sync.connected();
    expect(h.life(1)).toBe(40);
    expect(h.sync.getView().unconfirmed).toBe(0);
  });

  it('drops an action the host turned down, so the preview stops showing it', () => {
    const h = new Harness(bob);
    h.sync.connected();
    const theirs = h.host.append(alice, 'alice-0', hit(2, -6));
    h.sync.received(h.host.batchFor('log-1', 0));
    expect(theirs.ok && h.life(2)).toBe(34);

    h.sync.submit({ type: 'undo', target: 'alice-0' });

    expect(h.life(2)).toBe(34);
    expect(h.sync.getView().unconfirmed).toBe(0);
  });

  it('applies everyone’s changes in the host’s order', () => {
    const h = new Harness();
    h.sync.connected();
    const theirs = h.otherPlayer('bob-0', hit(0, -6));
    h.sync.received({ logId: 'log-1', from: theirs.seq, events: [theirs] });
    h.sync.submit(hit(0, 2));
    expect(h.life(0)).toBe(36);
  });

  it('catches up on everything it missed when reconnecting', () => {
    const h = new Harness();
    h.sync.connected();
    h.online = false;
    h.otherPlayer('bob-0', hit(0, -1));
    h.otherPlayer('bob-1', hit(0, -2));

    h.online = true;
    h.sync.connected();

    expect(h.life(0)).toBe(37);
    expect(h.sent.at(-1)).toEqual({ kind: 'sync', logId: 'log-1', from: 0 });
  });

  it('ignores entries it already has when batches overlap', () => {
    const h = new Harness();
    h.sync.connected();
    const entry = h.otherPlayer('bob-0', hit(0, -3));
    const batch: LogBatch = { logId: 'log-1', from: 0, events: [entry] };
    h.sync.received(batch);
    h.sync.received(batch);
    expect(h.life(0)).toBe(37);
  });

  it('asks for the gap when entries are missing', () => {
    const h = new Harness();
    h.sync.connected();
    h.otherPlayer('bob-0', hit(0, -1));
    const later = h.otherPlayer('bob-1', hit(0, -1));

    h.online = false;
    h.sync.received({ logId: 'log-1', from: later.seq, events: [later] });
    expect(h.sent.at(-1)).toEqual({ kind: 'sync', logId: 'log-1', from: 0 });
    expect(h.life(0)).toBe(40);
  });

  it('starts over when the host has a different log', () => {
    const h = new Harness();
    h.sync.connected();
    h.sync.submit(hit(0, -10));

    const otherTable = new HostGameLog('log-2', () => 0);
    const entry = added(otherTable.append(bob, 'x', hit(3, -1)));
    h.sync.received({ logId: 'log-2', from: 0, events: [entry] });

    expect(h.life(0)).toBe(40);
    expect(h.life(3)).toBe(39);
  });

  it('asks for the whole log when handed the middle of an unknown one', () => {
    const h = new Harness();
    h.online = false;
    const otherTable = new HostGameLog('log-2', () => 0);
    otherTable.append(bob, 'x', hit(3, -1));
    const second = added(otherTable.append(bob, 'y', hit(3, -1)));
    h.sync.received({ logId: 'log-2', from: 1, events: [second] });
    expect(h.sent.at(-1)).toEqual({ kind: 'sync', logId: null, from: 0 });
  });

  it('notifies listeners and keeps only the newest entries in the view', () => {
    const h = new Harness();
    const views: number[] = [];
    h.sync.subscribe((view) => views.push(view.logLength));
    h.sync.connected();
    for (let i = 0; i < 40; i++) h.sync.submit(hit(2, -1));
    expect(h.sync.getView().recent).toHaveLength(30);
    expect(h.sync.getView().recent.at(-1)?.seq).toBe(39);
    expect(views.at(-1)).toBe(40);
  });
});
