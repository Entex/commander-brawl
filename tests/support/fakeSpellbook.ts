import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

/** Commander Spellbook's bracket estimate, answered from a small table of known cards. */
const FLAGS: Record<string, { gameChanger?: boolean; massLandDenial?: boolean; extraTurn?: boolean }> = {
  'Rhystic Study': { gameChanger: true },
  "Thassa's Oracle": { gameChanger: true },
  Armageddon: { massLandDenial: true },
  'Time Warp': { extraTurn: true },
};

export interface FakeSpellbook {
  readonly apiUrl: string;
  failing: boolean;
  close(): Promise<void>;
}

export async function startFakeSpellbook(): Promise<FakeSpellbook> {
  const fake = { apiUrl: '', failing: false, close: async () => undefined } as FakeSpellbook & { apiUrl: string };
  const server = createServer((request, response) => {
    if (fake.failing || request.method !== 'POST' || request.url !== '/estimate-bracket') {
      response.writeHead(fake.failing ? 503 : 404).end();
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
