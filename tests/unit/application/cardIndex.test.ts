import { CardIndex, editDistance } from '@commander-brawl/application';
import { normalizeCardName, type Card } from '@commander-brawl/domain';
import { describe, expect, it } from 'vitest';

function card(name: string, extra: Partial<Card> = {}): Card {
  return {
    id: name,
    name,
    layout: 'normal',
    manaCost: '',
    typeLine: '',
    oracleText: '',
    stats: '',
    colorIdentity: [],
    manaValue: 0,
    commander: 'legal',
    gameChanger: false,
    image: null,
    artist: null,
    faces: [],
    keywords: [],
    ...extra,
  };
}

const face = (name: string) => ({ name, manaCost: '', typeLine: '', oracleText: '', stats: '', image: null });

const index = new CardIndex([
  card('Rhystic Study'),
  card('Rhystic Tutor'),
  card('White Rhystic Study'),
  card('Sol Ring'),
  card('Soldier', { layout: 'token' }),
  card("Atraxa, Praetors' Voice"),
  card('Atraxa, Grand Unifier'),
  card("Lim-Dûl's Vault"),
  card('Delver of Secrets // Insectile Aberration', {
    faces: [face('Delver of Secrets'), face('Insectile Aberration')],
  }),
  card('Demonic Consultation'),
]);
const names = (query: string, limit?: number) => index.search(query, limit).map((c) => c.name);

describe('card search', () => {
  it('puts an exact name first, then names that start with the query', () => {
    expect(names('rhystic study')).toEqual(['Rhystic Study', 'White Rhystic Study']);
    expect(names('rhystic')).toEqual(['Rhystic Study', 'Rhystic Tutor', 'White Rhystic Study']);
  });

  it('finds names from the start of each word', () => {
    expect(names('atr voi')).toEqual(["Atraxa, Praetors' Voice"]);
  });

  it('ignores case, accents and punctuation', () => {
    expect(names('LIM DULS')).toEqual(["Lim-Dûl's Vault"]);
    expect(names('praetors voice')).toEqual(["Atraxa, Praetors' Voice"]);
  });

  it('finds double-faced cards by either face', () => {
    expect(names('insectile')).toEqual(['Delver of Secrets // Insectile Aberration']);
  });

  it('forgives a typo or two', () => {
    expect(names('rhystc stdy')).toEqual(['Rhystic Study', 'White Rhystic Study']);
    expect(names('demonc consultaton')).toEqual(['Demonic Consultation']);
    expect(names('xyzzy')).toEqual([]);
  });

  it('puts real cards before tokens', () => {
    expect(names('sol')).toEqual(['Sol Ring', 'Soldier']);
  });

  it('stops at the limit', () => {
    expect(names('a', 2)).toHaveLength(2);
  });

  it('finds a card by the name in a deck list, including just the front face', () => {
    expect(index.byName('delver of secrets')?.name).toBe('Delver of Secrets // Insectile Aberration');
    expect(index.byName("Lim-Dul's Vault")?.name).toBe("Lim-Dûl's Vault");
    expect(index.byName('Rhystic')).toBeUndefined();
  });
});

describe('editDistance', () => {
  it('counts changes and gives up past the limit', () => {
    expect(editDistance('rhystc', 'rhystic', 2)).toBe(1);
    expect(editDistance('abc', 'xyz', 1)).toBe(2);
  });
});

describe('normalizeCardName', () => {
  it('makes names easy to compare', () => {
    expect(normalizeCardName("  Lim-Dûl's   Vault ")).toBe('lim duls vault');
    expect(normalizeCardName('Fire // Ice')).toBe('fire ice');
  });
});

describe('finding cards by a name read off a camera picture', () => {
  const read = (...texts: string[]) => index.closest(texts).map((m) => m.card.name);

  it('allows for misread letters and junk around the name', () => {
    expect(read('f Rhystic Study In')[0]).toBe('Rhystic Study');
    expect(read('( Rhystie Study')[0]).toBe('Rhystic Study');
    expect(read('Atraxa. Practory’ Voice .')[0]).toBe("Atraxa, Praetors' Voice");
    expect(read('Insectile Aberation')[0]).toBe('Delver of Secrets // Insectile Aberration');
  });

  it('finds nothing in a jumble of letters', () => {
    expect(read('—— Bl 4 nL | » >')).toEqual([]);
  });

  it('prefers the card whose whole name was read over one that merely contains it', () => {
    expect(read('White Rhystic Study')[0]).toBe('White Rhystic Study');
    expect(read('Sol Ring')[0]).toBe('Sol Ring');
  });

  it('prefers a card named so over a token or another card’s face of the same name', () => {
    const tricky = new CardIndex([
      card('Blood', { layout: 'token' }),
      card('Flesh // Blood', { faces: [face('Flesh'), face('Blood')] }),
      card('Swords to Plowshares'),
      card('Emeritus of Truce // Swords to Plowshares', {
        faces: [face('Emeritus of Truce'), face('Swords to Plowshares')],
      }),
    ]);
    expect(tricky.closest(['Swords to Plowshares'])[0]!.card.name).toBe('Swords to Plowshares');
    expect(tricky.byName('Blood')?.name).toBe('Blood');
  });
});
