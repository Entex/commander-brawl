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
    faces: [],
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
