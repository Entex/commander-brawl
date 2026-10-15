import type { Invite, SignalingEvent } from '@commander-brawl/application';
import {
  TableClient,
  TableServer,
  createIdentity,
  randomId,
  type TlsIdentity,
} from '@commander-brawl/infrastructure/node';
import type { Writable } from 'node:stream';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { FlakyNetwork } from '../support/flakyNetwork';
import { sleep, waitFor } from '../support/wait';

const GRACE_MS = 600;

class Player {
  readonly events: SignalingEvent[] = [];
  readonly client: TableClient;

  constructor(invite: Invite, name: string, spectator = false) {
    this.client = new TableClient({ invite, name, spectator, connectTimeoutMs: 1_000, silenceTimeoutMs: 1_000 });
    this.client.subscribe((event) => this.events.push(event));
    this.client.start();
  }

  get selfId(): string | undefined {
    return this.welcomes().at(-1)?.selfId;
  }

  get connection() {
    return this.events.filter((e) => e.type === 'connection').at(-1);
  }

  welcomes() {
    return this.events.filter((e): e is Extract<SignalingEvent, { type: 'welcome' }> => e.type === 'welcome');
  }

  signals() {
    return this.events.filter((e): e is Extract<SignalingEvent, { type: 'signal' }> => e.type === 'signal');
  }

  async seated(): Promise<string> {
    return waitFor(() => this.selfId, { message: 'a seat' });
  }
}

describe('hosting and joining a table', () => {
  let identity: TlsIdentity;
  const cleanups: (() => unknown)[] = [];

  beforeAll(async () => {
    identity = await createIdentity(['127.0.0.1']);
  });

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  async function host(options: { heartbeatMs?: number } = {}) {
    const secret = randomId();
    const server = await TableServer.start({
      identity,
      secret,
      preferredPort: 0,
      reconnectGraceMs: GRACE_MS,
      heartbeatMs: options.heartbeatMs ?? 200,
    });
    cleanups.push(() => server.close());
    const invite: Invite = { hosts: ['127.0.0.1'], port: server.port, secret, fingerprint: identity.fingerprint };
    return { server, invite };
  }

  function join(invite: Invite, name: string, spectator = false): Player {
    const player = new Player(invite, name, spectator);
    cleanups.push(() => player.client.close());
    return player;
  }

  it('seats players and introduces them to each other', async () => {
    const { invite } = await host();
    const alice = join(invite, 'Alice');
    await alice.seated();
    const bob = join(invite, 'Bob');
    const bobId = await bob.seated();

    expect(bob.welcomes()[0]!.members.map((m) => m.name)).toEqual(['Alice', 'Bob']);
    await waitFor(() => alice.events.some((e) => e.type === 'member-joined' && e.member.id === bobId));
  });

  it('lets a spectator watch: the players hear about them, and the game turns down their changes', async () => {
    const { invite } = await host();
    const alice = join(invite, 'Alice');
    await alice.seated();
    const sam = join(invite, 'Sam', true);
    const samId = await sam.seated();

    expect(sam.welcomes()[0]).toMatchObject({ members: [{ name: 'Alice' }], spectators: [{ id: samId, name: 'Sam' }] });
    await waitFor(() => alice.events.some((e) => e.type === 'spectator-joined' && e.spectator.id === samId));
    // Not a seat: four players can still sit down.
    const others = ['Bob', 'Carol', 'Dave'].map((name) => join(invite, name));
    await Promise.all(others.map((p) => p.seated()));

    const refused: string[] = [];
    sam.client.subscribeGame((update) => update.type === 'refused' && refused.push(update.id));
    sam.client.sendGame({ kind: 'event', id: 'sneaky', event: { type: 'life-changed', seat: 0, amount: -40 } });
    await waitFor(() => refused[0]);
    expect(refused).toEqual(['sneaky']);

    // Relaying video setup works with a spectator too.
    alice.client.send(samId, { offer: 'sdp' });
    await waitFor(() => sam.signals()[0]);
  });

  it('relays connection details between two players', async () => {
    const { invite } = await host();
    const alice = join(invite, 'Alice');
    const bob = join(invite, 'Bob');
    const aliceId = await alice.seated();
    const bobId = await bob.seated();

    alice.client.send(bobId, { offer: 'sdp' });

    const signal = await waitFor(() => bob.signals()[0]);
    expect(signal).toEqual({ type: 'signal', from: aliceId, data: { offer: 'sdp' } });
  });

  it('turns away a wrong invite secret', async () => {
    const { invite } = await host();
    const mallory = join({ ...invite, secret: randomId() }, 'Mallory');
    const closed = await waitFor(() => (mallory.connection?.state === 'closed' ? mallory.connection : null));
    expect(closed.reason).toMatch(/invite is wrong/);
  });

  it("isn't brought down by a stranger sending a message too big, or not a proper one, before saying hello", async () => {
    const { invite } = await host();
    const uncaught: unknown[] = [];
    const onUncaught = (error: unknown) => uncaught.push(error);
    process.on('uncaughtException', onUncaught);
    cleanups.push(() => process.off('uncaughtException', onUncaught));

    const stranger = async (send: (ws: WebSocket) => void) => {
      const ws = new WebSocket(`wss://127.0.0.1:${invite.port}/table`, { rejectUnauthorized: false });
      ws.on('error', () => undefined);
      await new Promise((resolve) => ws.once('open', resolve));
      const closed = new Promise((resolve) => ws.once('close', resolve));
      send(ws);
      await closed;
    };
    await stranger((ws) => ws.send('x'.repeat(9 * 1024 * 1024)));
    // A frame of a kind there's no such thing as.
    await stranger((ws) =>
      (ws as unknown as { _socket: Writable })._socket.write(Buffer.from([0x8f, 0x80, 0, 0, 0, 0])),
    );

    expect(uncaught).toEqual([]);
    // The table goes on.
    await join(invite, 'Alice').seated();
  });

  it('refuses to talk to a computer whose certificate does not match the invite', async () => {
    const { invite } = await host();
    const impostor = await createIdentity(['127.0.0.1']);
    const player = join({ ...invite, fingerprint: impostor.fingerprint }, 'Alice');

    await waitFor(() => player.connection?.reason?.includes('not the host'));
    expect(player.selfId).toBeUndefined();
  });

  it('turns away a fifth player', async () => {
    const { invite } = await host();
    for (const name of ['A', 'B', 'C', 'D']) await join(invite, name).seated();
    const fifth = join(invite, 'E');
    await waitFor(() => fifth.connection?.reason?.includes('table is full'));
  });

  it('gets a player back into the same seat after their connection drops', async () => {
    const { invite } = await host();
    const network = await FlakyNetwork.start(invite.port);
    cleanups.push(() => network.close());

    const alice = join(invite, 'Alice');
    await alice.seated();
    const bob = join({ ...invite, port: network.port }, 'Bob');
    const bobId = await bob.seated();

    network.cut();
    await waitFor(() => bob.connection?.state === 'reconnecting', { message: 'reconnecting' });
    await waitFor(() => bob.welcomes().length === 2, { message: 'a second welcome' });

    expect(bob.selfId).toBe(bobId);
    await sleep(GRACE_MS * 2);
    expect(alice.events.some((e) => e.type === 'member-left')).toBe(false);
  });

  it('frees the seat when a player stays away longer than the grace period', async () => {
    const { invite } = await host();
    const network = await FlakyNetwork.start(invite.port);
    cleanups.push(() => network.close());

    const alice = join(invite, 'Alice');
    await alice.seated();
    const bob = join({ ...invite, port: network.port }, 'Bob');
    const bobId = await bob.seated();

    network.block();

    const left = await waitFor(() => alice.events.find((e) => e.type === 'member-left'), { timeoutMs: GRACE_MS * 5 });
    expect(left).toEqual({ type: 'member-left', memberId: bobId });
  });

  it('reconnects when the host goes silent', async () => {
    // A connection can die without either side being told. The host pings regularly, so the player
    // treats silence as a dead connection. Here the host never pings, to trigger exactly that.
    const { invite } = await host({ heartbeatMs: 60_000 });
    const bob = join(invite, 'Bob');
    await bob.seated();

    await waitFor(() => bob.connection?.state === 'reconnecting', { timeoutMs: 3_000, message: 'silence detection' });
    await waitFor(() => bob.welcomes().length >= 2, { message: 'reconnect' });
  });

  it('tells everyone when the host closes the table', async () => {
    const { server, invite } = await host();
    const alice = join(invite, 'Alice');
    await alice.seated();

    await server.close();

    const closed = await waitFor(() => (alice.connection?.state === 'closed' ? alice.connection : null));
    expect(closed.reason).toBe('The host closed the table.');
  });

  it('frees the seat right away when a player leaves on purpose', async () => {
    const { invite } = await host();
    const alice = join(invite, 'Alice');
    const bob = join(invite, 'Bob');
    await alice.seated();
    const bobId = await bob.seated();

    bob.client.close();

    await waitFor(() => alice.events.some((e) => e.type === 'member-left' && e.memberId === bobId), {
      timeoutMs: GRACE_MS / 2,
    });
  });
});
