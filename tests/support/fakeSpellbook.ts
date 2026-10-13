import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

/** Commander Spellbook: its bracket estimate, answered from a small table of known cards, and deck links. */
const FLAGS: Record<string, { gameChanger?: boolean; massLandDenial?: boolean; extraTurn?: boolean }> = {
  'Rhystic Study': { gameChanger: true },
  "Thassa's Oracle": { gameChanger: true },
  Armageddon: { massLandDenial: true },
  'Time Warp': { extraTurn: true },
};

/** Decks on the deck-building sites, by where their links point. */
const LINKED_DECKS: Record<string, { commanders: string[]; main: string[] }> = {
  'moxfield.com/decks/Y8dZ7': { commanders: ["Atraxa, Praetors' Voice"], main: ['Sol Ring', 'Rhystic Study'] },
  'archidekt.com/decks/42': {
    commanders: ["Atraxa, Praetors' Voice"],
    main: ['Delver of Secrets // Insectile Aberration'],
  },
};
const SITES = ['moxfield.com', 'archidekt.com', 'tappedout.net', 'deckstats.net', 'scryfall.com'];

export interface FakeSpellbook {
  readonly apiUrl: string;
  failing: boolean;
  /** Answers 429 Too Many Requests. */
  busy: boolean;
  /** The User-Agent of the last request. */
  readonly userAgent: string;
  close(): Promise<void>;
}

export async function startFakeSpellbook(): Promise<FakeSpellbook> {
  const fake = {
    apiUrl: '',
    failing: false,
    busy: false,
    userAgent: '',
    close: async () => undefined,
  } as FakeSpellbook & {
    apiUrl: string;
    userAgent: string;
  };
  const server = createServer((request, response) => {
    fake.userAgent = request.headers['user-agent'] ?? '';
    const path = new URL(request.url ?? '/', 'http://spellbook');
    if (fake.failing || fake.busy) {
      response.writeHead(fake.busy ? 429 : 503).end();
      return;
    }
    if (request.method === 'GET' && path.pathname === '/card-list-from-url') {
      const link = new URL(path.searchParams.get('url') ?? '');
      const site = link.hostname.replace(/^www\./, '');
      const deck = Object.entries(LINKED_DECKS).find(([at]) => `${site}${link.pathname}`.startsWith(at))?.[1];
      const json = { 'Content-Type': 'application/json' };
      if (!SITES.includes(site)) response.writeHead(400, json).end('{"detail":"Unsupported website"}');
      else if (!deck) response.writeHead(400, json).end('{"detail":"Decklist not available"}');
      else {
        const entries = (names: string[]) => names.map((card) => ({ card, quantity: 1 }));
        response
          .writeHead(200, json)
          .end(JSON.stringify({ commanders: entries(deck.commanders), main: entries(deck.main) }));
      }
      return;
    }
    if (request.method !== 'POST' || path.pathname !== '/estimate-bracket') {
      response.writeHead(404).end();
      return;
    }
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      const deck = JSON.parse(body) as { commanders: { card: string }[]; main: { card: string }[] };
      const names = [...deck.commanders, ...deck.main].map((e) => e.card);
      const cards = names.map((name) => ({ card: { name }, quantity: 1, banned: false, ...FLAGS[name] }));
      const has = (...cards: string[]) => cards.every((card) => names.includes(card));
      const combos = [
        // A made-up three-card combo, listed first: the app sorts by size.
        ...(has('Sol Ring', 'Rhystic Study', "Atraxa, Praetors' Voice")
          ? [
              {
                definitelyTwoCard: false,
                combo: {
                  uses: ['Sol Ring', 'Rhystic Study', "Atraxa, Praetors' Voice"].map((name) => ({ card: { name } })),
                  produces: [{ feature: { name: 'Infinite test mana' } }],
                },
              },
            ]
          : []),
        ...(has("Thassa's Oracle", 'Demonic Consultation')
          ? [
              {
                definitelyTwoCard: true,
                combo: {
                  uses: [{ card: { name: 'Demonic Consultation' } }, { card: { name: "Thassa's Oracle" } }],
                  produces: [{ feature: { name: 'Exile your library' } }, { feature: { name: 'Win the game' } }],
                },
              },
            ]
          : []),
      ];
      response
        .writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ bracketTag: 'C', cards, combos }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  fake.apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  fake.close = () => new Promise((resolve) => server.close(() => resolve()));
  return fake;
}
