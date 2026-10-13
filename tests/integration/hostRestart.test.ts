import type { GameSync, Invite, SignalingEvent } from '@commander-brawl/application';
import type { GameEvent, SeatIndex } from '@commander-brawl/domain';
import {
  FileTableStore,
  TableClient,
  TableServer,
  createIdentity,
  randomId,
  syncGame,
  type TlsIdentity,
} from '@commander-brawl/infrastructure/node';
import { appendFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { waitFor } from '../support/wait';

interface Player {
  readonly client: TableClient;
  readonly game: GameSync;
  readonly events: SignalingEvent[];
}

const hit = (seat: SeatIndex, amount: number): GameEvent => ({ type: 'life-changed', seat, amount });
const lives = (player: Player) => player.game.getView().state.seats.map((s) => s.life);
const connectionOf = (player: Player) => {
  const first = player.client.snapshot()[0];
  return first?.type === 'connection' ? first.state : null;
};
const selfId = (player: Player) =>
  player.events.filter((e): e is Extract<SignalingEvent, { type: 'welcome' }> => e.type === 'welcome').at(-1)?.selfId;

describe("the host's app restarting", () => {
  let identity: TlsIdentity;
  const cleanups: (() => unknown)[] = [];

  beforeAll(async () => {
    identity = await createIdentity(['127.0.0.1']);
  });

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  function joinTable(invite: Invite, name: string): Player {
    const client = new TableClient({ invite, name, connectTimeoutMs: 500 });
    const game = syncGame(client);
    const events: SignalingEvent[] = [];
    client.subscribe((event) => events.push(event));
    cleanups.push(() => client.close());
    client.start();
    return { client, game, events };
  }

  const settle = (players: readonly Player[], length: number) =>
    waitFor(() => players.every((p) => p.game.getView().logLength === length && p.game.getView().unconfirmed === 0), {
      timeoutMs: 15_000,
      message: `everyone to have ${length} events`,
    });

  it('brings everyone back to their own seats with the game as it was', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cb-table-'));
    const secret = randomId();
    const store = new FileTableStore(dir);
    const first = await TableServer.start({ identity, secret, preferredPort: 0, store });
    store.begin({ secret, port: first.port, playerName: 'Alice', ownResumeToken: null });
    const invite: Invite = { hosts: ['127.0.0.1'], port: first.port, secret, fingerprint: identity.fingerprint };

    const alice = joinTable(invite, 'Alice');
    await waitFor(() => selfId(alice));
    const bob = joinTable(invite, 'Bob');
    await waitFor(() => selfId(bob));
    const ids = [selfId(alice), selfId(bob)];
    alice.game.submit(hit(1, -7));
    bob.game.submit(hit(0, -2));
    await settle([alice, bob], 2);

    // The host's app crashes: no goodbye, so the players keep trying to reconnect.
    await first.close({ notify: false });
    await waitFor(() => connectionOf(alice) === 'reconnecting', { message: 'Alice to notice the host is gone' });

    const saved = await FileTableStore.load(dir);
    expect(saved?.members.map((m) => m.player.name)).toEqual(['Alice', 'Bob']);
    expect(saved?.entries).toHaveLength(2);
    store.continue(saved!, saved!);
    const second = await TableServer.start({
      identity,
      secret,
      preferredPort: first.port,
      store,
      restore: { members: saved!.members, entries: saved!.entries },
    });
    cleanups.push(() => second.close());
    expect(second.port).toBe(first.port);

    // Both reconnect by themselves, into the same seats, with the same game.
    await waitFor(() => alice.events.filter((e) => e.type === 'welcome').length === 2, { timeoutMs: 15_000 });
    await waitFor(() => bob.events.filter((e) => e.type === 'welcome').length === 2, { timeoutMs: 15_000 });
    expect([selfId(alice), selfId(bob)]).toEqual(ids);
    await settle([alice, bob], 2);
    expect(lives(bob)).toEqual([38, 33, 40, 40]);

    // And the game carries on, saved as before.
    bob.game.submit(hit(1, 3));
    await settle([alice, bob], 3);
    expect(lives(alice)).toEqual([38, 36, 40, 40]);
    expect((await FileTableStore.load(dir))?.entries).toHaveLength(3);
  });

  it('lets players go who do not come back in time', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cb-table-'));
    const secret = randomId();
    const store = new FileTableStore(dir);
    const first = await TableServer.start({ identity, secret, preferredPort: 0, store });
    store.begin({ secret, port: first.port, playerName: 'Alice', ownResumeToken: null });
    const invite: Invite = { hosts: ['127.0.0.1'], port: first.port, secret, fingerprint: identity.fingerprint };
    const alice = joinTable(invite, 'Alice');
    await waitFor(() => selfId(alice));
    alice.client.close();
    const bob = joinTable(invite, 'Bob');
    await waitFor(() => selfId(bob));
    await first.close({ notify: false });

    const saved = (await FileTableStore.load(dir))!;
    const second = await TableServer.start({
      identity,
      secret,
      preferredPort: first.port,
      restore: { members: saved.members, entries: saved.entries },
      restoreGraceMs: 200,
    });
    cleanups.push(() => second.close());
    await waitFor(() => second.members.length === 1 && second.members[0]!.name === 'Bob', { timeoutMs: 15_000 });
  });
});

describe('the saved table', () => {
  it('survives a crash in the middle of writing an event', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cb-table-'));
    const store = new FileTableStore(dir);
    store.begin({ secret: 's', port: 1, playerName: 'Alice', ownResumeToken: null });
    const by = { id: 'a', name: 'Alice', seat: 0 as const };
    store.eventAdded({ seq: 0, id: 'e0', at: Date.now(), by, event: hit(0, -1) });
    store.eventAdded({ seq: 1, id: 'e1', at: Date.now(), by, event: hit(0, -1) });
    await appendFile(join(dir, 'log.jsonl'), '{"seq":2,"id":"e2","at":1');

    expect((await FileTableStore.load(dir))?.entries.map((e) => e.id)).toEqual(['e0', 'e1']);
  });

  it('is forgotten after a day', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cb-table-'));
    new FileTableStore(dir).begin({ secret: 's', port: 1, playerName: 'Alice', ownResumeToken: null });
    expect(await FileTableStore.load(dir)).not.toBeNull();
    expect(await FileTableStore.load(dir, Date.now() + 25 * 60 * 60 * 1000)).toBeNull();
  });

  it('is gone once the table is closed on purpose', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cb-table-'));
    const store = new FileTableStore(dir);
    store.begin({ secret: 's', port: 1, playerName: 'Alice', ownResumeToken: null });
    store.clear();
    expect(await FileTableStore.load(dir)).toBeNull();
  });
});
