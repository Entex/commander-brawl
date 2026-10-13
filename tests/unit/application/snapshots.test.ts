import {
  SnapshotError,
  Snapshots,
  clampCrop,
  type SignalingEvent,
  type TableSignaling,
} from '@commander-brawl/application';
import { describe, expect, it } from 'vitest';
import { FakeTimers } from '../../support/fakeTimers';

/** Two players' signaling, wired to each other like the host would. */
function pair() {
  const listeners = new Map<string, (event: SignalingEvent) => void>();
  const signaling = (self: string): TableSignaling => ({
    subscribe(listener) {
      listeners.set(self, listener);
      return () => listeners.delete(self);
    },
    send(to, data) {
      queueMicrotask(() => listeners.get(to)?.({ type: 'signal', from: self, data }));
    },
  });
  return { alice: signaling('alice'), bob: signaling('bob') };
}

const crop = { x: 0.4, y: 0.3, width: 0.2, height: 0.4 };

describe('Snapshots', () => {
  it("asks the other player's computer for a picture and gets it back", async () => {
    const timers = new FakeTimers();
    const { alice, bob } = pair();
    const asked: unknown[] = [];
    const mine = new Snapshots(alice, null, { timers, createId: () => 'r1' });
    const theirs = new Snapshots(
      bob,
      { capture: async (c) => (asked.push(c), 'data:image/jpeg;base64,AAA') },
      {
        timers,
        createId: () => 'x',
      },
    );
    mine.start();
    theirs.start();

    await expect(mine.request('bob', crop)).resolves.toBe('data:image/jpeg;base64,AAA');
    expect(asked).toEqual([crop]);
  });

  it('says why when the other player has no camera or it fails', async () => {
    const timers = new FakeTimers();
    const { alice, bob } = pair();
    const mine = new Snapshots(alice, null, { timers, createId: () => 'r1' });
    mine.start();
    new Snapshots(bob, null, { timers, createId: () => 'x' }).start();
    await expect(mine.request('bob', crop)).rejects.toThrow("They don't have a camera on.");

    const failing = pair();
    const asker = new Snapshots(failing.alice, null, { timers, createId: () => 'r2' });
    asker.start();
    new Snapshots(
      failing.bob,
      { capture: () => Promise.reject(new Error('lens cap')) },
      { timers, createId: () => 'y' },
    ).start();
    await expect(asker.request('bob', crop)).rejects.toThrow('lens cap');
  });

  it('gives up when nobody answers', async () => {
    const timers = new FakeTimers();
    const { alice } = pair();
    const mine = new Snapshots(alice, null, { timers, createId: () => 'r1', timeoutMs: 1000 });
    mine.start();
    const request = mine.request('nobody', crop);
    timers.advance(1000);
    await expect(request).rejects.toBeInstanceOf(SnapshotError);
  });

  it('keeps the crop inside the picture', () => {
    expect(clampCrop({ x: 0.95, y: -0.2, width: 0.2, height: 0.5 })).toEqual({ x: 0.8, y: 0, width: 0.2, height: 0.5 });
    expect(clampCrop({ x: 0, y: 0, width: 3, height: 0 })).toEqual({ x: 0, y: 0, width: 1, height: 0.02 });
  });
});
