import { ScryfallCards } from '@commander-brawl/infrastructure/node';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startFakeScryfall, type FakeScryfall } from '../support/fakeScryfall';
import { temporaryDirs } from '../support/temporaryDirs';

const temporaryDir = temporaryDirs();

describe('card data from Scryfall', () => {
  let fake: FakeScryfall;

  afterEach(async () => {
    await fake.close();
  });

  async function scryfall(options: { gzip?: boolean } = {}) {
    fake = await startFakeScryfall(options);
    const dir = await temporaryDir('cb-cards-');
    return { dir, cards: new ScryfallCards({ dir, appVersion: '0.1.0', apiUrl: fake.apiUrl }) };
  }

  it('downloads, keeps the playable cards, and saves them for next time', async () => {
    const { dir, cards } = await scryfall();
    const progress: number[] = [];

    const saved = await cards.download((fraction) => progress.push(fraction));

    expect(saved.cards.map((c) => c.name)).toEqual([
      'Rhystic Study',
      'Delver of Secrets // Insectile Aberration',
      'Fire // Ice',
      "Atraxa, Praetors' Voice",
      'Demonic Consultation',
      'Soldier',
      'Sol Ring',
      // Planes, a phenomenon and schemes stay: Planechase and Archenemy use them.
      'Tolaria Test Grounds',
      'Bant of Tests',
      'Test Phenomenon',
      'My Test Plan',
      'Ongoing Test Plan',
    ]);
    expect(saved.updatedAt).toBe('2026-10-13T09:00:00.000+00:00');
    expect(progress.at(-1)).toBe(1);
    expect(progress.every((p, i) => i === 0 || p >= progress[i - 1]!)).toBe(true);

    const again = await new ScryfallCards({ dir, appVersion: '0.1.0', apiUrl: fake.apiUrl }).loadSaved();
    expect(again?.cards).toHaveLength(12);
  });

  it('keeps what the table needs from each card', async () => {
    const { cards } = await scryfall();
    const saved = await cards.download();
    const byName = (name: string) => saved.cards.find((c) => c.name === name)!;

    expect(byName('Rhystic Study')).toMatchObject({
      id: 'rhystic',
      manaCost: '{2}{U}',
      gameChanger: true,
      commander: 'legal',
      image: 'front/a/b/rhystic.jpg?1',
      artist: 'Rhystic Painter',
      faces: [],
    });
    expect(byName("Atraxa, Praetors' Voice").stats).toBe('4/4');
    expect(byName("Atraxa, Praetors' Voice").keywords).toEqual([
      'Flying',
      'Vigilance',
      'Deathtouch',
      'Lifelink',
      'Proliferate',
    ]);
    expect(byName('Sol Ring').keywords).toEqual([]);

    const delver = byName('Delver of Secrets // Insectile Aberration');
    expect(delver.image).toBe('front/d/e/delver.jpg?1');
    expect(delver.artist).toBe('Delver Painter');
    expect(delver.manaCost).toBe('{U}');
    expect(delver.faces.map((f) => [f.name, f.stats, f.image])).toEqual([
      ['Delver of Secrets', '1/1', 'front/d/e/delver.jpg?1'],
      ['Insectile Aberration', '3/2', 'back/d/e/delver.jpg?1'],
    ]);
    expect(byName('Fire // Ice').oracleText).toContain('Tap target permanent.');
  });

  it('serves rulings per card', async () => {
    const { dir, cards } = await scryfall();
    await cards.download();
    // A fresh instance reads them from disk.
    const fresh = new ScryfallCards({ dir, appVersion: '0.1.0', apiUrl: fake.apiUrl });
    expect(await fresh.rulings('rhystic')).toEqual([
      { date: '2023-09-01', text: 'You may pay {1} or not.' },
      { date: '2024-01-01', text: 'It triggers on every spell.' },
    ]);
    expect(await fresh.rulings('sol-ring')).toEqual([]);
  });

  it('copes with servers that unzip the files on the way', async () => {
    const { cards } = await scryfall({ gzip: false });
    expect((await cards.download()).cards).toHaveLength(12);
  });

  it('reports Scryfall being down, and keeps what it had', async () => {
    const { cards } = await scryfall();
    await cards.download();
    fake.failing = true;

    await expect(cards.download()).rejects.toThrow('503');
    expect((await cards.loadSaved())?.cards).toHaveLength(12);
  });

  it('still uses cards saved before artists were kept, until new ones are in', async () => {
    const { dir, cards } = await scryfall();
    const card = { id: 'sol-ring', name: 'Sol Ring' };
    const old = { version: 1, cards: [card], updatedAt: '2026-01-01', savedAt: Date.now() };
    await writeFile(join(dir, 'cards.json'), JSON.stringify(old));
    const saved = await cards.loadSaved();
    expect(saved?.cards).toEqual([{ ...card, artist: null, keywords: [] }]);
    // As if they were old, so new ones are downloaded right away.
    expect(saved?.savedAt).toBe(0);
  });

  it('still uses cards saved before keywords were kept, until new ones are in', async () => {
    const { dir, cards } = await scryfall();
    const card = { id: 'sol-ring', name: 'Sol Ring', artist: 'Mark Tedin' };
    const old = { version: 2, cards: [card], updatedAt: '2026-01-01', savedAt: Date.now() };
    await writeFile(join(dir, 'cards.json'), JSON.stringify(old));
    const saved = await cards.loadSaved();
    expect(saved?.cards).toEqual([{ ...card, keywords: [] }]);
    expect(saved?.savedAt).toBe(0);
  });

  it('finds the pictures of printings a deck list names, and every artwork of cards', async () => {
    const { cards } = await scryfall();
    expect(
      await cards.printingImages([
        { set: 'cmm', number: '400' },
        { set: 'xyz', number: '1' },
      ]),
    ).toEqual(['front/s/1/sol-ring-cmm.jpg?2', null]);
    const artworks = await cards.artworks(['sol-ring', 'rhystic', 'nothing']);
    expect(artworks.get('sol-ring')).toEqual([
      'front/s/r/sol-ring.jpg?1',
      'front/s/1/sol-ring-cmm.jpg?2',
      'front/s/2/sol-ring-sld.jpg?3',
    ]);
    expect(artworks.get('rhystic')).toEqual(['front/a/b/rhystic.jpg?1']);
    expect(artworks.get('nothing')).toEqual([]);
  });

  it('has nothing saved before the first download', async () => {
    const { cards } = await scryfall();
    expect(await cards.loadSaved()).toBeNull();
  });
});
