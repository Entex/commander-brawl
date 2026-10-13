import type { DeckList } from '@commander-brawl/domain';
import { analyzeDeck, fetchDeck, isDeckLink, UnsupportedDeckLinkError } from '@commander-brawl/infrastructure/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFakeSpellbook, type FakeSpellbook } from '../support/fakeSpellbook';

const card = (name: string) => ({ id: name, name, count: 1 });

describe('checking a deck with Commander Spellbook', () => {
  let spellbook: FakeSpellbook;

  beforeAll(async () => {
    spellbook = await startFakeSpellbook();
  });

  afterAll(async () => {
    await spellbook.close();
  });

  it('finds Game Changers, land denial, extra turns, and combos: all of them, and which are two cards', async () => {
    const deck: DeckList = {
      name: 'Thoracle',
      commanders: [card("Thassa's Oracle")],
      cards: [
        'Demonic Consultation',
        'Rhystic Study',
        'Armageddon',
        'Time Warp',
        'Sol Ring',
        "Atraxa, Praetors' Voice",
      ].map(card),
    };
    const thoracle = {
      cards: ['Demonic Consultation', "Thassa's Oracle"],
      produces: ['Exile your library', 'Win the game'],
    };
    expect(await analyzeDeck(deck, { appVersion: '0.1.0', apiUrl: spellbook.apiUrl })).toEqual({
      gameChangers: ["Thassa's Oracle", 'Rhystic Study'],
      massLandDenial: ['Armageddon'],
      extraTurns: ['Time Warp'],
      twoCardCombos: [thoracle],
      // Fewest cards first.
      combos: [
        thoracle,
        { cards: ['Sol Ring', 'Rhystic Study', "Atraxa, Praetors' Voice"], produces: ['Infinite test mana'] },
      ],
      complete: true,
    });
  });

  it('fails clearly when Spellbook is down', async () => {
    spellbook.failing = true;
    const deck: DeckList = { name: 'X', commanders: [], cards: [card('Sol Ring')] };
    await expect(analyzeDeck(deck, { appVersion: '0.1.0', apiUrl: spellbook.apiUrl })).rejects.toThrow('503');
    spellbook.failing = false;
  });
});

describe('decks from deck-building sites, read by Commander Spellbook', () => {
  let spellbook: FakeSpellbook;
  const options = () => ({ appVersion: '0.1.0', apiUrl: spellbook.apiUrl });

  beforeAll(async () => {
    spellbook = await startFakeSpellbook();
  });

  afterAll(async () => {
    await spellbook.close();
  });

  it('reads a Moxfield deck, saying who is asking', async () => {
    expect(await fetchDeck('https://www.moxfield.com/decks/Y8dZ7', options())).toEqual({
      name: null,
      commanders: [{ name: "Atraxa, Praetors' Voice", count: 1 }],
      cards: [
        { name: 'Sol Ring', count: 1 },
        { name: 'Rhystic Study', count: 1 },
      ],
      sideboard: [],
    });
    expect(spellbook.userAgent).toBe('CommanderBrawl/0.1.0 (+https://github.com/Entex/commander-brawl)');
  });

  it('reads an Archidekt deck', async () => {
    const deck = await fetchDeck('https://archidekt.com/decks/42/delver_tribal', options());
    expect(deck.commanders).toEqual([{ name: "Atraxa, Praetors' Voice", count: 1 }]);
    expect(deck.cards).toEqual([{ name: 'Delver of Secrets // Insectile Aberration', count: 1 }]);
  });

  it('says so when a deck is missing or private, or Spellbook is busy', async () => {
    await expect(fetchDeck('https://moxfield.com/decks/nope', options())).rejects.toThrow(
      "Moxfield doesn't have that deck",
    );
    spellbook.busy = true;
    await expect(fetchDeck('https://moxfield.com/decks/Y8dZ7', options())).rejects.toThrow('Try again in a minute');
    spellbook.busy = false;
  });

  it('only takes links to sites Spellbook reads', async () => {
    await expect(fetchDeck('https://example.com/decks/1', options())).rejects.toBeInstanceOf(UnsupportedDeckLinkError);
    expect(isDeckLink('https://moxfield.com/decks/Y8dZ7')).toBe(true);
    expect(isDeckLink('1 Sol Ring\n1 Rhystic Study')).toBe(false);
  });
});
