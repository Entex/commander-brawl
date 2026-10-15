import { CardIndex, tokensMadeBy } from '@commander-brawl/application';
import type { Card } from '@commander-brawl/domain';
import { describe, expect, it } from 'vitest';

function card(name: string, oracleText: string, more: Partial<Card> = {}): Card {
  return {
    id: name.toLowerCase().replace(/\W+/g, '-'),
    name,
    layout: 'normal',
    manaCost: '',
    typeLine: 'Creature',
    oracleText,
    stats: '',
    colorIdentity: [],
    manaValue: 0,
    commander: 'legal',
    gameChanger: false,
    image: null,
    artist: null,
    faces: [],
    keywords: [],
    ...more,
  };
}

function face(name: string) {
  return { name, manaCost: '', typeLine: `Token — ${name}`, oracleText: '', stats: '', image: null };
}

function token(name: string, stats: string, colors: string[], id = name.toLowerCase().replace(/\W+/g, '-')): Card {
  return card(name, '', { id, layout: 'token', typeLine: `Token Creature — ${name}`, stats, colorIdentity: colors });
}

describe('the tokens a card makes', () => {
  it.each([
    ['Whenever you cast a spell, create a 1/1 red Goblin creature token with haste.', 'Goblin', '1/1', ['R']],
    ['When this enters, create a Treasure token.', 'Treasure', null, null],
    ['Create two 1/1 white and black Spirit creature tokens with flying.', 'Spirit', '1/1', ['W', 'B']],
    ['Create a 1/1 colorless Thopter artifact creature token with flying.', 'Thopter', '1/1', []],
    ['Create X 2/2 black Zombie creature tokens.', 'Zombie', '2/2', ['B']],
    [
      'Create a 0/1 colorless Eldrazi Spawn creature token with "Sacrifice this token: Add {C}."',
      'Eldrazi Spawn',
      '0/1',
      [],
    ],
    ['Create a 1/1 white Human Soldier creature token.', 'Human Soldier', '1/1', ['W']],
    ['Create an X/X green Ooze creature token.', 'Ooze', null, ['G']],
    [
      'Investigate. (Create a Clue token. It\'s an artifact with "{2}, Sacrifice this token: Draw a card.")',
      'Clue',
      null,
      null,
    ],
    [
      "Amass Zombies 2. (Put two +1/+1 counters on an Army you control. It's also a Zombie. If you don't control one, create a 0/0 black Zombie Army creature token first.)",
      'Zombie Army',
      '0/0',
      ['B'],
    ],
  ])('%s', (text, name, stats, colors) => {
    expect(tokensMadeBy(card('Some card', text))).toContainEqual({ name, stats, colors });
  });

  it('reads every token a card makes, and its faces', () => {
    const twoFaced = card('Front // Back', '', {
      faces: [
        { name: 'Front', manaCost: '', typeLine: '', oracleText: 'Create a Food token.', stats: '', image: null },
        {
          name: 'Back',
          manaCost: '',
          typeLine: '',
          oracleText: 'Create a Blood token and a Map token.',
          stats: '',
          image: null,
        },
      ],
    });
    expect(tokensMadeBy(twoFaced).map((spec) => spec.name)).toEqual(['Food', 'Blood', 'Map']);
  });

  it('reads how many apart from the name, and a token with a name of its own', () => {
    expect(tokensMadeBy(card('Some card', 'Create X Treasure tokens.'))).toEqual([
      { name: 'Treasure', stats: null, colors: null },
    ]);
    const depths = card(
      'Dark Depths',
      'Remove all ice counters: create Marit Lage, a legendary 20/20 black Avatar creature token with flying and indestructible.',
    );
    expect(tokensMadeBy(depths).map((spec) => spec.name)).toContain('Marit Lage');
  });

  it("doesn't take a copy, or a token of no kind, for a token", () => {
    expect(
      tokensMadeBy(
        card('Some card', "Create a token that's a copy of target creature. Each creature token gets +1/+1."),
      ),
    ).toEqual([]);
  });
});

describe('finding the tokens in the card data', () => {
  const index = new CardIndex([
    card('Goblin Instigator', 'Create a 1/1 red Goblin creature token.'),
    token('Goblin', '1/1', ['R']),
    token('Goblin', '2/1', ['B'], 'goblin-black'),
    token('Treasure', '', []),
    { ...token('Vampire // Treasure', '', ['W']), faces: [face('Vampire'), face('Treasure')] },
    token('Soldier', '1/1', ['W']),
    token('Avatar', '4/4', ['W']),
  ]);

  it('by name, size and colors', () => {
    expect(index.tokens([{ name: 'Goblin', stats: '1/1', colors: ['R'] }]).map((c) => c.id)).toEqual(['goblin']);
    expect(index.tokens([{ name: 'treasure', stats: null, colors: null }]).map((c) => c.id)).toEqual(['treasure']);
  });

  it('a token of just that name before one with it on a face', () => {
    expect(index.tokens([{ name: 'Treasure', stats: null, colors: null }]).map((c) => c.id)).toEqual(['treasure']);
    expect(index.tokens([{ name: 'Vampire', stats: null, colors: null }]).map((c) => c.id)).toEqual([
      'vampire-treasure',
    ]);
  });

  it("of the size said, any color if none is the one said; and not cards that aren't tokens", () => {
    expect(index.tokens([{ name: 'Goblin', stats: '1/1', colors: ['G'] }]).map((c) => c.id)).toEqual(['goblin']);
    expect(index.tokens([{ name: 'Goblin', stats: null, colors: null }]).map((c) => c.id)).toEqual([
      'goblin',
      'goblin-black',
    ]);
    // A 20/20 Avatar (Marit Lage) isn't some other Avatar.
    expect(index.tokens([{ name: 'Avatar', stats: '20/20', colors: ['B'] }])).toEqual([]);
    expect(index.tokens([{ name: 'Goblin Instigator', stats: null, colors: null }])).toEqual([]);
  });
});
