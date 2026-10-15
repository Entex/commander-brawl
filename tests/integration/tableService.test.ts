import { decodeInvite, type GameRecord, type GameSync, type Invite } from '@commander-brawl/application';
import { TableClient, createIdentity, syncGame, type TlsIdentity } from '@commander-brawl/infrastructure/node';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { TableService } from '../../src/desktop/src/main/tableService';
import { temporaryDirs } from '../support/temporaryDirs';
import { waitFor } from '../support/wait';

const temporaryDir = temporaryDirs();

describe('hosting, leaving and coming back, as the app does it', () => {
  let identity: TlsIdentity;
  const cleanups: (() => unknown)[] = [];

  beforeAll(async () => {
    identity = await createIdentity(['127.0.0.1']);
  });

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  async function app(gamesFinished: (games: readonly GameRecord[]) => void = () => undefined): Promise<TableService> {
    const service = new TableService({
      identity,
      preferredPort: 0,
      useUpnp: false,
      findPublicAddress: false,
      tableDir: join(await temporaryDir('cb-service-'), 'hosted-table'),
      emit: () => undefined,
      emitGame: () => undefined,
      gamesFinished,
    });
    cleanups.push(() => service.leave());
    return service;
  }

  function joinTable(invite: Invite, name: string): { client: TableClient; game: GameSync } {
    const client = new TableClient({ invite, name, connectTimeoutMs: 500 });
    const game = syncGame(client);
    cleanups.push(() => client.close());
    client.start();
    return { client, game };
  }

  it('forgets a table it closed at once: the start screen, asking right after, has nothing to resume', async () => {
    const service = await app();
    await service.host('Robin');
    // As the app does: the start screen asks while the table is still closing.
    const leaving = service.leave();
    expect(await service.savedTable()).toBeNull();
    await leaving;
  });

  it('keeps a table hosted right after closing the one before', async () => {
    const service = await app();
    await service.host('Robin');
    const leaving = service.leave();
    await service.host('Robin');
    // The first table done closing: the second one is still saved.
    await leaving;
    expect(await service.savedTable()).toMatchObject({ playerName: 'Robin' });
  });

  it("records a finished game once, even when the host's app restarted in between", async () => {
    const finished: GameRecord[] = [];
    const service = await app((games) => finished.push(...games));
    const info = await service.host('Robin');
    const alex = joinTable({ ...decodeInvite(info.invite), hosts: ['127.0.0.1'] }, 'Alex');
    await waitFor(() => alex.client.snapshot().some((event) => event.type === 'welcome'), { message: 'Alex seated' });

    service.submitGameEvent({ type: 'turn-order-chosen', order: [0, 1] });
    service.submitGameEvent({ type: 'life-changed', seat: 1, amount: -40 });
    await waitFor(() => service.gameView()?.logLength === 2, { message: 'the game played' });

    // The app quits (the game is recorded), opens again, and the table is resumed and then closed.
    await service.shutdown();
    expect(finished.map((game) => game.winner)).toEqual([0]);
    await service.resume();
    await waitFor(() => service.gameView()?.logLength === 2, { timeoutMs: 10_000, message: 'the table back' });
    await service.leave();

    expect(finished.length).toBeGreaterThan(1);
    expect(new Set(finished.map((game) => game.id)).size).toBe(1);
  });
});
