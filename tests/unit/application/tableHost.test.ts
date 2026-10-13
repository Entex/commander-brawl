import { TableHost, type JoinResult } from '@commander-brawl/application';
import type { Player } from '@commander-brawl/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import { FakeTimers } from '../../support/fakeTimers';

const SECRET = 'correct-horse-battery-staple';
const GRACE_MS = 30_000;

describe('TableHost', () => {
  let timers: FakeTimers;
  let host: TableHost;
  let joined: Player[];
  let left: Player[];

  beforeEach(() => {
    timers = new FakeTimers();
    let counter = 0;
    host = new TableHost({ secret: SECRET, reconnectGraceMs: GRACE_MS, timers, createId: () => `id-${counter++}` });
    joined = [];
    left = [];
    host.addListener({ memberJoined: (m) => joined.push(m), memberLeft: (m) => left.push(m) });
  });

  const join = (name: string, resumeToken?: string) => host.join({ secret: SECRET, name, resumeToken });
  const accepted = (result: JoinResult) => {
    if (!result.ok) throw new Error(`rejected: ${result.reason}`);
    return result;
  };

  it('seats players who know the secret and tells the others', () => {
    const alice = accepted(join('Alice'));
    const bob = accepted(join('Bob'));

    expect(alice.member.seat).toBe(0);
    expect(bob.member.seat).toBe(1);
    expect(bob.members.map((m) => m.name)).toEqual(['Alice', 'Bob']);
    expect(joined.map((m) => m.name)).toEqual(['Alice', 'Bob']);
  });

  it('lets people watch: no seat, and the players hear about them', () => {
    const watched: string[] = [];
    const gone: string[] = [];
    host.addListener({
      memberJoined: () => undefined,
      memberLeft: () => undefined,
      spectatorJoined: (s) => watched.push(s.name),
      spectatorLeft: (s) => gone.push(s.name),
    });
    accepted(join('Alice'));
    const sam = host.watch({ secret: SECRET, name: 'Sam' });
    if (!sam.ok) throw new Error(sam.reason);
    expect(sam.members.map((m) => m.name)).toEqual(['Alice']);
    expect(sam.spectators).toEqual([sam.spectator]);
    expect(watched).toEqual(['Sam']);
    // Not taking a seat: four players still fit.
    for (const name of ['Bob', 'Carol', 'Dave']) accepted(join(name));
    expect(host.members).toHaveLength(4);

    // Back after a dropped connection, as the same spectator; gone for good after the grace period.
    host.connectionLost(sam.spectator.id);
    const again = host.watch({ secret: SECRET, name: 'Sam', resumeToken: sam.resumeToken });
    expect(again).toMatchObject({ ok: true, resumed: true, spectator: sam.spectator });
    host.leave(sam.spectator.id);
    expect(gone).toEqual(['Sam']);
    expect(host.spectators).toEqual([]);
  });

  it('turns away a spectator with the wrong secret, and too many spectators', () => {
    expect(host.watch({ secret: 'nope', name: 'Sam' })).toEqual({ ok: false, reason: 'bad-secret' });
    for (let i = 0; i < 8; i++) expect(host.watch({ secret: SECRET, name: `Fan ${i}` }).ok).toBe(true);
    expect(host.watch({ secret: SECRET, name: 'One too many' })).toEqual({ ok: false, reason: 'too-many-spectators' });
  });

  it('turns away wrong secrets, bad names and a fifth player', () => {
    expect(host.join({ secret: 'nope', name: 'Mallory' })).toEqual({ ok: false, reason: 'bad-secret' });
    expect(join('   ')).toEqual({ ok: false, reason: 'bad-name' });
    for (const name of ['A', 'B', 'C', 'D']) accepted(join(name));
    expect(join('E')).toEqual({ ok: false, reason: 'table-full' });
  });

  it('keeps the seat for a player who reconnects within the grace period', () => {
    const alice = accepted(join('Alice'));
    accepted(join('Bob'));

    host.connectionLost(alice.member.id);
    timers.advance(GRACE_MS - 1);
    const back = accepted(join('Alice', alice.resumeToken));

    expect(back.resumed).toBe(true);
    expect(back.member).toEqual(alice.member);
    timers.advance(GRACE_MS);
    expect(left).toEqual([]);
  });

  it('frees the seat once the grace period runs out', () => {
    const alice = accepted(join('Alice'));

    host.connectionLost(alice.member.id);
    timers.advance(GRACE_MS);

    expect(left.map((m) => m.name)).toEqual(['Alice']);
    const again = accepted(join('Alice', alice.resumeToken));
    expect(again.resumed).toBe(false);
    expect(again.member.id).not.toBe(alice.member.id);
  });

  it('brings players back to their own seats after the host restarts, if they come back in time', () => {
    const alice = accepted(join('Alice'));
    const bob = accepted(join('Bob'));
    const saved = host.savedMembers();

    const restarted = new TableHost({ secret: SECRET, reconnectGraceMs: GRACE_MS, timers, createId: () => 'new' });
    const gone: string[] = [];
    restarted.addListener({ memberJoined: () => undefined, memberLeft: (m) => gone.push(m.name) });
    restarted.restore(saved, 60_000);

    const back = restarted.join({ secret: SECRET, name: 'Bob', resumeToken: bob.resumeToken });
    expect(back).toMatchObject({ ok: true, resumed: true, member: bob.member });
    timers.advance(60_000);
    expect(gone).toEqual(['Alice']);
    expect(restarted.members.map((m) => m.seat)).toEqual([bob.member.seat]);
    expect(alice.member.seat).toBe(0);
  });

  it('frees the seat at once when a player leaves on purpose', () => {
    const alice = accepted(join('Alice'));
    host.leave(alice.member.id);
    expect(left.map((m) => m.name)).toEqual(['Alice']);
    expect(host.members).toEqual([]);
  });
});
