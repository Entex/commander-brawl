import { GameSync } from '@commander-brawl/application';
import { randomId } from './runtime';
import type { TableClient } from './tableClient';

/** Keeps this player's copy of the game in step with the host, over the table connection. */
export function syncGame(client: TableClient): GameSync {
  const game = new GameSync({ send: (message) => client.sendGame(message) }, randomId);
  client.subscribe((event) => {
    if (event.type === 'welcome') game.connected();
  });
  client.subscribeGame((batch) => game.received(batch));
  return game;
}
