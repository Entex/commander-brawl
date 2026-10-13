import type { GameSync, Invite } from '@commander-brawl/application';
import type { GameEvent, SeatIndex } from '@commander-brawl/domain';
import {
  TableClient,
  TableServer,
  createIdentity,
  randomId,
  syncGame,
  type TlsIdentity,
} from '@commander-brawl/infrastructure/node';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { FlakyNetwork } from '../support/flakyNetwork';
import { waitFor } from '../support/wait';

interface Player {
  readonly client: TableClient;
  readonly game: GameSync;
}

const hit = (seat: SeatIndex, amount: number): GameEvent => ({ type: 'life-changed', seat, amount });
const lives = (player: Player) => player.game.getView().state.seats.map((s) => s.life);
const logIds = (player: Player) => player.game.getView().recent.map((e) => e.id);
const connectionOf = (player: Player) => {
  const first = player.client.snapshot()[0];
  return first?.type === 'connection' ? first.state : null;
};

describe('shared game state', () => {
  let identity: TlsIdentity;
  const cleanups: (() => unknown)[] = [];

  beforeAll(async () => {
    identity = await createIdentity(['127.0.0.1']);
  });

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  async function host(): Promise<Invite> {
    const secret = randomId();
    const server = await TableServer.start({ identity, secret, preferredPort: 0, heartbeatMs: 200 });
    cleanups.push(() => server.close());
    return { hosts: ['127.0.0.1'], port: server.port, secret, fingerprint: identity.fingerprint };
  }

  async function join(invite: Invite, name: string): Promise<Player> {
    const client = new TableClient({ invite, name, connectTimeoutMs: 1_000, silenceTimeoutMs: 1_000 });
    const game = syncGame(client);
    cleanups.push(() => client.close());
    let seated = false;
    client.subscribe((event) => {
      if (event.type === 'welcome') seated = true;
    });
    client.start();
    await waitFor(() => seated, { message: `${name} to be seated` });
    return { client, game };
  }

  /** Waits until every player's log has `length` entries, all applied. */
  async function settle(players: readonly Player[], length: number): Promise<void> {
    await waitFor(
      () => players.every((p) => p.game.getView().logLength === length && p.game.getView().unconfirmed === 0),
      { message: `everyone to have ${length} events` },
    );
  }

  it('two players changing the same life total at the same moment both count, and everyone agrees', async () => {
    const invite = await host();
    const alice = await join(invite, 'Alice');
    const bob = await join(invite, 'Bob');
    const cleo = await join(invite, 'Cleo');

    alice.game.submit(hit(2, -3));
    bob.game.submit(hit(2, -5));

    await settle([alice, bob, cleo], 2);
    for (const player of [alice, bob, cleo]) expect(lives(player)).toEqual([40, 40, 32, 40]);
    expect(logIds(bob)).toEqual(logIds(alice));
    expect(logIds(cleo)).toEqual(logIds(alice));
  });

  it('four players making many changes at once end up with the same game, in the same order', async () => {
    const invite = await host();
    const players = await Promise.all(['A', 'B', 'C', 'D'].map((name) => join(invite, name)));

    let total = 0;
    for (let round = 0; round < 25; round++) {
      players.forEach((player, index) => {
        player.game.submit(hit(((index + round) % 4) as SeatIndex, (round % 7) - 3 || 1));
        total++;
      });
    }

    await settle(players, total);
    const [first, ...rest] = players;
    for (const player of rest) {
      expect(lives(player)).toEqual(lives(first!));
      expect(logIds(player)).toEqual(logIds(first!));
    }
  });

  it('a player who drops out catches up when they reconnect, without anyone redoing anything', async () => {
    const invite = await host();
    const network = await FlakyNetwork.start(invite.port);
    cleanups.push(() => network.close());
    const alice = await join(invite, 'Alice');
    const bob = await join({ ...invite, port: network.port }, 'Bob');
    alice.game.submit(hit(0, -1));
    await settle([alice, bob], 1);

    network.block();
    await waitFor(() => connectionOf(bob) === 'reconnecting');
    alice.game.submit(hit(1, -4));
    alice.game.submit({ type: 'new-game', startingLife: 40 });
    alice.game.submit(hit(0, -2));
    await settle([alice], 4);
    network.unblock();

    await settle([alice, bob], 4);
    expect(lives(bob)).toEqual(lives(alice));
    expect(bob.game.getView().state.number).toBe(2);
  });

  it('changes made while the connection is down reach everyone once it is back', async () => {
    const invite = await host();
    const network = await FlakyNetwork.start(invite.port);
    cleanups.push(() => network.close());
    const alice = await join(invite, 'Alice');
    const bob = await join({ ...invite, port: network.port }, 'Bob');

    network.block();
    await waitFor(() => connectionOf(bob) === 'reconnecting');
    bob.game.submit(hit(0, -7));

    // Bob sees his own change straight away; it's queued until the host has it.
    expect(lives(bob)[0]).toBe(33);
    expect(bob.game.getView().unconfirmed).toBe(1);
    expect(lives(alice)[0]).toBe(40);

    network.unblock();
    await settle([alice, bob], 1);
    expect(lives(alice)[0]).toBe(33);
    expect(lives(bob)[0]).toBe(33);
  });

  it('a player who joins late gets the whole game so far', async () => {
    const invite = await host();
    const alice = await join(invite, 'Alice');
    alice.game.submit(hit(0, -10));
    alice.game.submit(hit(1, 3));
    await settle([alice], 2);

    const latecomer = await join(invite, 'Late');

    await settle([alice, latecomer], 2);
    expect(lives(latecomer)).toEqual([30, 43, 40, 40]);
    expect(latecomer.game.getView().recent.map((e) => e.by.name)).toEqual(['Alice', 'Alice']);
  });

  it('the host records who made each change, so nobody can pretend to be someone else', async () => {
    const invite = await host();
    const alice = await join(invite, 'Alice');
    const bob = await join(invite, 'Bob');
    bob.game.submit(hit(0, -2));
    await settle([alice, bob], 1);
    expect(alice.game.getView().recent[0]?.by).toMatchObject({ name: 'Bob', seat: 1 });
  });
});
