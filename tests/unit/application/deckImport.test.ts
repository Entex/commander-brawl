import { chooseCommanders, parseDeckText, resolveDeck } from '@commander-brawl/application';
import { normalizeCardName, type Card } from '@commander-brawl/domain';
import { describe, expect, it } from 'vitest';

function card(name: string, typeLine = 'Artifact', oracleText = ''): Card {
  return {
    id: normalizeCardName(name).replaceAll(' ', '-'),
    name,
    layout: 'normal',
    manaCost: '',
    typeLine,
    oracleText,
    stats: '',
    colorIdentity: [],
    manaValue: 0,
    commander: 'legal',
    gameChanger: false,
    image: null,
    faces: [],
  };
}

const cards = [
  card("Atraxa, Praetors' Voice", 'Legendary Creature — Phyrexian Angel Horror'),
  card('Winota, Joiner of Forces', 'Legendary Creature — Human Warrior'),
  card('Tymna the Weaver', 'Legendary Creature — Human Cleric'),
  card('Kraum, Ludevic’s Opus', 'Legendary Creature — Zombie Horror'),
  card('Sol Ring'),
  card('Arcane Signet'),
  card('Mountain', 'Basic Land — Mountain'),
  card('Smothering Tithe', 'Enchantment'),
];
const lookup = (name: string) => cards.find((c) => normalizeCardName(c.name) === normalizeCardName(name));
const names = (entries: readonly { name: string; count: number }[]) => entries.map((e) => `${e.count} ${e.name}`);

describe('reading deck lists', () => {
  it('reads Arena-style sections', () => {
    const raw = parseDeckText(`Commander
1 Winota, Joiner of Forces

Deck
1 Sol Ring
30 Mountain`);
    expect(names(raw.commanders)).toEqual(['1 Winota, Joiner of Forces']);
    expect(names(raw.cards)).toEqual(['1 Sol Ring', '30 Mountain']);
  });

  it('reads Moxfield exports with sets, collector numbers and foil marks', () => {
    const raw = parseDeckText(`1 Atraxa, Praetors' Voice (2XM) 190 *CMDR*
1x Sol Ring (CMM) 400 *F*
1 Arcane Signet [ELD]
1 Smothering Tithe (RNA) 22a`);
    expect(names(raw.commanders)).toEqual(["1 Atraxa, Praetors' Voice"]);
    expect(names(raw.cards)).toEqual(['1 Sol Ring', '1 Arcane Signet', '1 Smothering Tithe']);
  });

  it("reads Archidekt's text export with categories", () => {
    const raw = parseDeckText(`1x Tymna the Weaver (c16) 48 [Commander{top}]
1x Kraum, Ludevic’s Opus (c16) 35 [Commander{top}]
1x Sol Ring (cmm) 400 [Ramp]
1x Arcane Signet (eld) 331 [Maybeboard{noDeck}{noPrice}]`);
    expect(names(raw.commanders)).toEqual(['1 Tymna the Weaver', '1 Kraum, Ludevic’s Opus']);
    expect(names(raw.cards)).toEqual(['1 Sol Ring']);
  });

  it('skips sideboards, maybeboards, tokens and comments, and reads a name line', () => {
    const raw = parseDeckText(`Name: Winota Stax
// a comment
Deck (2)
1 Sol Ring
Mountain

Maybeboard
1 Smothering Tithe
Tokens:
1 Soldier`);
    expect(raw.name).toBe('Winota Stax');
    expect(names(raw.cards)).toEqual(['1 Sol Ring', '1 Mountain']);
  });

  it('finds the commander in an MTGO-style sideboard', () => {
    const imported = resolveDeck(
      parseDeckText(`1 Sol Ring
1 Mountain

SIDEBOARD:
1 Winota, Joiner of Forces`),
      lookup,
      'Untitled',
    );
    expect(imported.deck.commanders.map((c) => c.name)).toEqual(['Winota, Joiner of Forces']);
  });
});

describe('matching a deck list to cards', () => {
  it('finds the cards, merges duplicates, and lists names it does not know', () => {
    const imported = resolveDeck(
      parseDeckText(`Commander
1 Atraxa, Praetors' Voice
Deck
1 Sol Ring
1 sol ring
20 Mountain
1 Not A Real Card`),
      lookup,
      'My deck',
    );
    expect(imported.deck).toEqual({
      name: 'My deck',
      commanders: [{ id: 'atraxa-praetors-voice', name: "Atraxa, Praetors' Voice", count: 1 }],
      cards: [
        { id: 'sol-ring', name: 'Sol Ring', count: 2 },
        { id: 'mountain', name: 'Mountain', count: 20 },
      ],
    });
    expect(imported.unknown).toEqual(['Not A Real Card']);
  });

  it('offers the legendary creatures as commanders when the list does not say', () => {
    const imported = resolveDeck(
      parseDeckText('1 Tymna the Weaver\n1 Sol Ring\n1 Winota, Joiner of Forces'),
      lookup,
      'D',
    );
    expect(imported.deck.commanders).toEqual([]);
    expect(imported.commanderCandidates.map((c) => c.name)).toEqual(['Tymna the Weaver', 'Winota, Joiner of Forces']);

    const chosen = chooseCommanders(imported.deck, ['tymna-the-weaver']);
    expect(chosen.commanders.map((c) => c.name)).toEqual(['Tymna the Weaver']);
    expect(chosen.cards.map((c) => c.name)).toEqual(['Sol Ring', 'Winota, Joiner of Forces']);
  });
});
