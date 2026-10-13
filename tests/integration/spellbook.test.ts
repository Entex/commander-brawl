import type { DeckList } from '@commander-brawl/domain';
import { analyzeDeck } from '@commander-brawl/infrastructure/node';
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
