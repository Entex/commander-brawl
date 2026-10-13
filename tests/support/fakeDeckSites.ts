import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

/** Moxfield's and Archidekt's deck APIs, trimmed down to the parts the app reads, served locally. */
export const MOXFIELD_DECK = {
  id: 'Y8dZ7',
  name: 'Atraxa Counters',
  boards: {
    commanders: { count: 1, cards: { a: { quantity: 1, card: { name: "Atraxa, Praetors' Voice" } } } },
    mainboard: {
      count: 2,
      cards: {
        b: { quantity: 1, card: { name: 'Sol Ring' } },
        c: { quantity: 1, card: { name: 'Rhystic Study' } },
      },
    },
    maybeboard: { count: 1, cards: { d: { quantity: 1, card: { name: 'Demonic Consultation' } } } },
  },
};

export const ARCHIDEKT_DECK = {
  id: 42,
  name: 'Delver Tribal',
  categories: [
    { name: 'Commander', includedInDeck: true },
    { name: 'Maybeboard', includedInDeck: false },
  ],
  cards: [
    { quantity: 1, categories: ['Commander'], card: { oracleCard: { name: "Atraxa, Praetors' Voice" } } },
    {
      quantity: 1,
      categories: ['Creature'],
      card: { oracleCard: { name: 'Delver of Secrets // Insectile Aberration' } },
    },
    { quantity: 1, categories: ['Maybeboard'], card: { oracleCard: { name: 'Sol Ring' } } },
  ],
};

export interface FakeDeckSites {
  readonly moxfieldApi: string;
  readonly archidektApi: string;
  close(): Promise<void>;
}

export async function startFakeDeckSites(): Promise<FakeDeckSites> {
  const server = createServer((request, response) => {
    const path = request.url ?? '';
    const body =
      path === '/moxfield/v3/decks/all/Y8dZ7'
        ? MOXFIELD_DECK
        : path === '/archidekt/api/decks/42/'
          ? ARCHIDEKT_DECK
          : null;
    if (!body) {
      response.writeHead(404, { 'Content-Type': 'application/json' }).end('{"status":404}');
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    moxfieldApi: `${base}/moxfield`,
    archidektApi: `${base}/archidekt`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
