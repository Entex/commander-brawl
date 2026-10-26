import {
  SnapshotError,
  Snapshots,
  clampCrop,
  type SignalingEvent,
  type TableSignaling,
} from '@commander-brawl/application';
import { describe, expect, it, vi } from 'vitest';
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
const canShareCamera = () => true;

describe('Snapshots', () => {
  it("asks the other player's computer for a picture and gets it back", async () => {
    const timers = new FakeTimers();
    const { alice, bob } = pair();
    const asked: unknown[] = [];
    const mine = new Snapshots(alice, null, { timers, createId: () => 'r1', canShareCamera });
    const theirs = new Snapshots(
      bob,
      { capture: async (c) => (asked.push(c), 'data:image/jpeg;base64,AAA') },
      {
        timers,
        createId: () => 'x',
        canShareCamera,
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
    const mine = new Snapshots(alice, null, { timers, createId: () => 'r1', canShareCamera });
    mine.start();
    new Snapshots(bob, null, { timers, createId: () => 'x', canShareCamera }).start();
    await expect(mine.request('bob', crop)).rejects.toThrow("They don't have a camera on.");

    const failing = pair();
    const asker = new Snapshots(failing.alice, null, { timers, createId: () => 'r2', canShareCamera });
    asker.start();
    new Snapshots(
      failing.bob,
      { capture: () => Promise.reject(new Error('lens cap')) },
      { timers, createId: () => 'y', canShareCamera },
    ).start();
    await expect(asker.request('bob', crop)).rejects.toThrow('lens cap');
  });

  it('gives up when nobody answers', async () => {
    const timers = new FakeTimers();
    const { alice } = pair();
    const mine = new Snapshots(alice, null, { timers, createId: () => 'r1', canShareCamera, timeoutMs: 1000 });
    mine.start();
    const request = mine.request('nobody', crop);
    timers.advance(1000);
    await expect(request).rejects.toBeInstanceOf(SnapshotError);
  });

  it('keeps the crop inside the picture', () => {
    expect(clampCrop({ x: 0.95, y: -0.2, width: 0.2, height: 0.5 })).toEqual({ x: 0.8, y: 0, width: 0.2, height: 0.5 });
    expect(clampCrop({ x: 0, y: 0, width: 3, height: 0 })).toEqual({ x: 0, y: 0, width: 1, height: 0.02 });
  });

  it('denies a crafted request while camera sharing is disabled, even with a camera source', async () => {
    const { alice, bob } = pair();
    let sharing = false;
    const capture = vi.fn(async () => 'data:image/jpeg;base64,AAA');
    const mine = new Snapshots(alice, null, { timers: new FakeTimers(), createId: () => 'r1', canShareCamera });
    new Snapshots(
      bob,
      { capture },
      {
        timers: new FakeTimers(),
        createId: () => 'r2',
        canShareCamera: () => sharing,
      },
    ).start();
    mine.start();
    await expect(mine.request('bob', crop)).rejects.toThrow("They don't have a camera on.");
    expect(capture).not.toHaveBeenCalled();
    sharing = true;
    await expect(mine.request('bob', crop)).resolves.toBe('data:image/jpeg;base64,AAA');
    sharing = false;
    await expect(mine.request('bob', crop)).rejects.toThrow("They don't have a camera on.");
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it.each(['permission revoked', 'disposed'] as const)('discards an in-flight picture when %s', async (reason) => {
    const { alice, bob } = pair();
    const results: unknown[] = [];
    alice.subscribe((event) => results.push(event));
    let sharing = true;
    let finish!: (image: string) => void;
    const capture = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    const responder = new Snapshots(
      bob,
      { capture },
      {
        timers: new FakeTimers(),
        createId: () => 'x',
        canShareCamera: () => sharing,
      },
    );
    responder.start();
    alice.send('bob', { snapshot: { kind: 'request', id: 'raw', crop } });
    await Promise.resolve();
    expect(capture).toHaveBeenCalledOnce();
    if (reason === 'disposed') responder.dispose();
    else sharing = false;
    finish('data:image/jpeg;base64,PRIVATE');
    await Promise.resolve();
    await Promise.resolve();
    expect(JSON.stringify(results)).not.toContain('PRIVATE');
    if (reason === 'permission revoked') expect(results).toHaveLength(1);
    else expect(results).toHaveLength(0);
  });

  it.each([
    { ...crop, x: -0.1 },
    { ...crop, y: -0.1 },
    { ...crop, width: 2 },
    { ...crop, height: 2 },
    { ...crop, x: 0.9 },
    { ...crop, y: 0.9 },
    { ...crop, width: 0 },
    { ...crop, height: 0 },
    { ...crop, width: -0.2 },
    { ...crop, height: -0.2 },
    { ...crop, x: NaN },
    { ...crop, y: Infinity },
    { ...crop, width: -Infinity },
    { ...crop, height: '0.4' },
    null,
  ])('does not capture an invalid incoming crop: %j', async (invalid) => {
    const { alice, bob } = pair();
    const capture = vi.fn(async () => 'data:image/jpeg;base64,PRIVATE');
    new Snapshots(
      bob,
      { capture },
      {
        timers: new FakeTimers(),
        createId: () => 'x',
        canShareCamera,
      },
    ).start();
    // Bypass request(), as a modified client would: sender-side clamping is not a security boundary.
    alice.send('bob', { snapshot: { kind: 'request', id: 'raw', crop: invalid } });
    await Promise.resolve();
    expect(capture).not.toHaveBeenCalled();
  });

  it.each([
    { x: 0, y: 0, width: 1, height: 1 },
    { x: 0.98, y: 0.98, width: 0.02, height: 0.02 },
  ])('accepts an incoming crop at the edge of the shared view: %j', async (boundary) => {
    const { alice, bob } = pair();
    const capture = vi.fn(async () => 'data:image/jpeg;base64,AAA');
    new Snapshots(
      bob,
      { capture },
      {
        timers: new FakeTimers(),
        createId: () => 'x',
        canShareCamera,
      },
    ).start();
    alice.send('bob', { snapshot: { kind: 'request', id: 'raw', crop: boundary } });
    await Promise.resolve();
    expect(capture).toHaveBeenCalledWith(boundary);
  });
});
