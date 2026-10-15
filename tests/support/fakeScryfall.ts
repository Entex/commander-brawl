import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';

/** A few cards in Scryfall's own format, covering the shapes the app has to handle. */
export const SCRYFALL_CARDS = [
  {
    oracle_id: 'rhystic',
    name: 'Rhystic Study',
    layout: 'normal',
    games: ['paper', 'mtgo'],
    mana_cost: '{2}{U}',
    type_line: 'Enchantment',
    oracle_text: 'Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.',
    color_identity: ['U'],
    cmc: 3,
    legalities: { commander: 'legal' },
    game_changer: true,
    artist: 'Rhystic Painter',
    image_uris: { normal: 'https://cards.scryfall.io/normal/front/a/b/rhystic.jpg?1' },
  },
  {
    oracle_id: 'delver',
    name: 'Delver of Secrets // Insectile Aberration',
    layout: 'transform',
    games: ['paper'],
    color_identity: ['U'],
    cmc: 1,
    legalities: { commander: 'legal' },
    // Each face its own picture, by its own artist.
    artist: 'Delver Painter // Aberration Painter',
    card_faces: [
      {
        name: 'Delver of Secrets',
        artist: 'Delver Painter',
        mana_cost: '{U}',
        type_line: 'Creature — Human Wizard',
        oracle_text: 'At the beginning of your upkeep, look at the top card of your library.',
        power: '1',
        toughness: '1',
        image_uris: { normal: 'https://cards.scryfall.io/normal/front/d/e/delver.jpg?1' },
      },
      {
        name: 'Insectile Aberration',
        artist: 'Aberration Painter',
        mana_cost: '',
        type_line: 'Creature — Human Insect',
        oracle_text: 'Flying',
        power: '3',
        toughness: '2',
        image_uris: { normal: 'https://cards.scryfall.io/normal/back/d/e/delver.jpg?1' },
      },
    ],
  },
  {
    oracle_id: 'fire-ice',
    name: 'Fire // Ice',
    layout: 'split',
    games: ['paper'],
    mana_cost: '{1}{R} // {1}{U}',
    type_line: 'Instant // Instant',
    color_identity: ['R', 'U'],
    cmc: 4,
    legalities: { commander: 'legal' },
    image_uris: { normal: 'https://cards.scryfall.io/normal/front/f/i/fire-ice.jpg?1' },
    card_faces: [
      {
        name: 'Fire',
        mana_cost: '{1}{R}',
        type_line: 'Instant',
        oracle_text: 'Fire deals 2 damage divided as you choose.',
      },
      { name: 'Ice', mana_cost: '{1}{U}', type_line: 'Instant', oracle_text: 'Tap target permanent.\nDraw a card.' },
    ],
  },
  {
    oracle_id: 'atraxa',
    name: "Atraxa, Praetors' Voice",
    layout: 'normal',
    games: ['paper'],
    mana_cost: '{G}{W}{U}{B}',
    type_line: 'Legendary Creature — Phyrexian Angel Horror',
    oracle_text: 'Flying, vigilance, deathtouch, lifelink\nAt the beginning of your end step, proliferate.',
    power: '4',
    toughness: '4',
    color_identity: ['B', 'G', 'U', 'W'],
    cmc: 4,
    legalities: { commander: 'legal' },
    artist: 'Atraxa Painter',
    keywords: ['Flying', 'Vigilance', 'Deathtouch', 'Lifelink', 'Proliferate'],
    image_uris: { normal: 'https://cards.scryfall.io/normal/front/a/t/atraxa.jpg?1' },
  },
  {
    // Represented by an MTGO printing, but a real paper card: must be kept.
    oracle_id: 'consultation',
    name: 'Demonic Consultation',
    layout: 'normal',
    games: ['mtgo'],
    digital: true,
    mana_cost: '{B}',
    type_line: 'Instant',
    oracle_text: 'Choose a card name. Exile the top six cards of your library...',
    color_identity: ['B'],
    cmc: 1,
    legalities: { commander: 'legal' },
    image_uris: { normal: 'https://cards.scryfall.io/normal/front/d/c/consultation.jpg?1' },
  },
  {
    oracle_id: 'soldier-token',
    name: 'Soldier',
    layout: 'token',
    games: ['paper'],
    type_line: 'Token Creature — Soldier',
    oracle_text: '',
    power: '1',
    toughness: '1',
    color_identity: ['W'],
    legalities: { commander: 'not_legal' },
    image_uris: { normal: 'https://cards.scryfall.io/normal/front/s/o/soldier.jpg?1' },
  },
  {
    oracle_id: 'sol-ring',
    name: 'Sol Ring',
    layout: 'normal',
    games: ['paper'],
    mana_cost: '{1}',
    type_line: 'Artifact',
    oracle_text: '{T}: Add {C}{C}.',
    color_identity: [],
    cmc: 1,
    legalities: { commander: 'legal' },
    image_uris: { normal: 'https://cards.scryfall.io/normal/front/s/r/sol-ring.jpg?1' },
  },
  // Made-up planes, a phenomenon and schemes, for Planechase and Archenemy.
  ...['Tolaria Test Grounds', 'Bant of Tests'].map((name) => ({
    oracle_id: `plane-${name.toLowerCase().replace(/\W+/g, '-')}`,
    name,
    layout: 'planar',
    games: ['paper'],
    type_line: 'Plane — Testland',
    oracle_text: 'Whenever you roll {CHAOS}, draw a card.',
    legalities: { commander: 'not_legal' },
  })),
  {
    oracle_id: 'phenomenon-test',
    name: 'Test Phenomenon',
    layout: 'planar',
    games: ['paper'],
    type_line: 'Phenomenon',
    oracle_text: 'When you encounter Test Phenomenon, each player draws a card. Then planeswalk away.',
    legalities: { commander: 'not_legal' },
  },
  ...[
    ['My Test Plan', 'Scheme'],
    ['Ongoing Test Plan', 'Ongoing Scheme'],
  ].map(([name, type]) => ({
    oracle_id: `scheme-${name!.toLowerCase().replace(/\W+/g, '-')}`,
    name,
    layout: 'scheme',
    games: ['paper'],
    type_line: type,
    oracle_text: 'When you set this scheme in motion, each opponent loses 1 life.',
    legalities: { commander: 'not_legal' },
  })),
  // Not playable cards: skipped.
  { oracle_id: 'art', name: 'Atraxa // Atraxa', layout: 'art_series', games: ['paper'], legalities: {} },
  {
    oracle_id: 'alchemy',
    name: 'A-Arena Only',
    layout: 'normal',
    games: ['arena'],
    digital: true,
    legalities: { commander: 'not_legal' },
  },
];

export const SCRYFALL_RULINGS = [
  { object: 'ruling', oracle_id: 'rhystic', published_at: '2023-09-01', comment: 'You may pay {1} or not.' },
  { object: 'ruling', oracle_id: 'rhystic', published_at: '2024-01-01', comment: 'It triggers on every spell.' },
];

export interface FakeScryfall {
  readonly apiUrl: string;
  /** How many times each path was asked for. */
  readonly requests: Map<string, number>;
  /** Makes the next requests fail, like Scryfall being down. */
  failing: boolean;
  close(): Promise<void>;
}

/** Serves the fixture cards the way Scryfall serves its bulk files: a list, then gzipped JSON Lines. */
export async function startFakeScryfall({ gzip = true } = {}): Promise<FakeScryfall> {
  const lines = (items: readonly unknown[]) => Buffer.from(items.map((i) => JSON.stringify(i)).join('\n') + '\n');
  const files: Record<string, Buffer> = {
    '/files/oracle-cards.jsonl.gz': gzip ? gzipSync(lines(SCRYFALL_CARDS)) : lines(SCRYFALL_CARDS),
    '/files/rulings.jsonl.gz': gzip ? gzipSync(lines(SCRYFALL_RULINGS)) : lines(SCRYFALL_RULINGS),
  };
  const requests = new Map<string, number>();
  let base = '';
  const fake: FakeScryfall = {
    get apiUrl() {
      return base;
    },
    requests,
    failing: false,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
  const server: Server = createServer((request, response) => {
    const path = request.url ?? '/';
    requests.set(path, (requests.get(path) ?? 0) + 1);
    if (fake.failing) {
      response.writeHead(503).end();
      return;
    }
    if (path === '/bulk-data') {
      const entry = (type: string, file: string) => ({
        object: 'bulk_data',
        type,
        updated_at: '2026-10-13T09:00:00.000+00:00',
        jsonl_download_uri: `${base}${file}`,
        compressed_size: files[file]!.length,
      });
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(
        JSON.stringify({
          object: 'list',
          data: [entry('oracle_cards', '/files/oracle-cards.jsonl.gz'), entry('rulings', '/files/rulings.jsonl.gz')],
        }),
      );
      return;
    }
    const file = files[path];
    if (!file) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/gzip' });
    response.end(file);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return fake;
}
