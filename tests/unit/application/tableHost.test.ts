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

  it('frees the seat at once when a player leaves on purpose', () => {
    const alice = accepted(join('Alice'));
    host.leave(alice.member.id);
    expect(left.map((m) => m.name)).toEqual(['Alice']);
    expect(host.members).toEqual([]);
  });
});
