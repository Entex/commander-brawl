import {
  Pointers,
  toPointer,
  type Pointer,
  type SignalingEvent,
  type TableSignaling,
} from '@commander-brawl/application';
import { describe, expect, it } from 'vitest';

/** Three players' signaling, wired to each other like the host would. */
function table() {
  const listeners = new Map<string, (event: SignalingEvent) => void>();
  const sent: { from: string; to: string }[] = [];
  const signaling = (self: string): TableSignaling => ({
    subscribe(listener) {
      listeners.set(self, listener);
      return () => listeners.delete(self);
    },
    send(to, data) {
      sent.push({ from: self, to });
      listeners.get(to)?.({ type: 'signal', from: self, data });
    },
  });
  return { signaling, sent };
}

describe('pings and arrows', () => {
  it('go to every other player, who see who pointed', () => {
    const { signaling, sent } = table();
    const alice = new Pointers(signaling('alice'), () => ['bob', 'carol']);
    const bob = new Pointers(signaling('bob'), () => ['alice', 'carol']);
    const carol = new Pointers(signaling('carol'), () => ['alice', 'bob']);
    for (const p of [alice, bob, carol]) p.start();
    const seen: string[] = [];
    bob.subscribe((from, pointer) => seen.push(`bob saw ${from}'s ${pointer.kind}`));
    carol.subscribe((from, pointer) => seen.push(`carol saw ${from}'s ${pointer.kind}`));

    alice.point({ kind: 'ping', at: { seat: 1, x: 0.5, y: 0.25 } });
    alice.point({ kind: 'arrow', from: { seat: 0, x: 0.1, y: 0.9 }, to: { seat: 2, x: 0.6, y: 0.4 } });

    expect(seen).toEqual([
      "bob saw alice's ping",
      "carol saw alice's ping",
      "bob saw alice's arrow",
      "carol saw alice's arrow",
    ]);
    expect(sent.every((s) => s.from === 'alice')).toBe(true);
  });

  it('ignore other messages and anything that is not a pointer', () => {
    const valid: Pointer = { kind: 'ping', at: { seat: 3, x: 0, y: 1 } };
    expect(toPointer({ pointer: valid })).toEqual(valid);
    for (const bad of [
      null,
      { snapshot: {} },
      { pointer: { kind: 'ping', at: { seat: 4, x: 0.5, y: 0.5 } } },
      { pointer: { kind: 'ping', at: { seat: 0, x: 1.5, y: 0.5 } } },
      { pointer: { kind: 'arrow', from: { seat: 0, x: 0.5, y: 0.5 } } },
      { pointer: { kind: 'laser', at: { seat: 0, x: 0.5, y: 0.5 } } },
    ]) {
      expect(toPointer(bad)).toBeNull();
    }
  });
});
