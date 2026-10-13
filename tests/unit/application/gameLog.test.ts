import {
  GameSync,
  HostGameLog,
  type GameSyncMessage,
  type LogBatch,
  type LoggedEvent,
} from '@commander-brawl/application';
import type { GameEvent, Player } from '@commander-brawl/domain';
import { beforeEach, describe, expect, it } from 'vitest';

const alice: Player = { id: 'alice', name: 'Alice', seat: 0 };
const bob: Player = { id: 'bob', name: 'Bob', seat: 1 };
const hit = (seat: 0 | 1 | 2 | 3, amount: number): GameEvent => ({ type: 'life-changed', seat, amount });

describe('HostGameLog', () => {
  let log: HostGameLog;

  beforeEach(() => {
    let time = 1_000;
    log = new HostGameLog('log-1', () => time++);
  });

  it('numbers events in the order they arrive and records who and when', () => {
    const first = log.append(alice, 'e1', hit(1, -3));
    const second = log.append(bob, 'e2', hit(0, -2));

    expect(first).toEqual({ seq: 0, id: 'e1', at: 1_000, by: alice, event: hit(1, -3) });
    expect(second?.seq).toBe(1);
    expect(log.length).toBe(2);
  });

  it('ignores an event it already has, so a resend is harmless', () => {
    log.append(alice, 'e1', hit(1, -3));
    expect(log.append(alice, 'e1', hit(1, -3))).toBeNull();
    expect(log.length).toBe(1);
  });

  it('refuses invalid events', () => {
    expect(log.append(alice, 'e1', { type: 'life-changed', seat: 9, amount: 1 })).toBeNull();
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
    const entry = this.host.append(bob, id, event)!;
    return entry;
  }

  private deliver(message: GameSyncMessage): boolean {
    this.sent.push(message);
    if (!this.online) return false;
    if (message.kind === 'event') {
      const entry = this.host.append(this.player, message.id, message.event);
      if (entry) this.sync.received({ logId: this.host.logId, from: entry.seq, events: [entry] });
    } else {
      this.sync.received(this.host.batchFor(message.logId, message.from));
    }
    return true;
  }
}

describe('GameSync', () => {
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
    const entry = otherTable.append(bob, 'x', hit(3, -1))!;
    h.sync.received({ logId: 'log-2', from: 0, events: [entry] });

    expect(h.life(0)).toBe(40);
    expect(h.life(3)).toBe(39);
  });

  it('asks for the whole log when handed the middle of an unknown one', () => {
    const h = new Harness();
    h.online = false;
    const otherTable = new HostGameLog('log-2', () => 0);
    otherTable.append(bob, 'x', hit(3, -1));
    const second = otherTable.append(bob, 'y', hit(3, -1))!;
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
