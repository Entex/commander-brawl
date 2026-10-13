import { fetchDeck, isDeckLink, UnsupportedDeckLinkError } from '@commander-brawl/infrastructure/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFakeDeckSites, type FakeDeckSites } from '../support/fakeDeckSites';

describe('decks from deck-building sites', () => {
  let sites: FakeDeckSites;
  const options = () => ({ appVersion: '0.1.0', moxfieldApi: sites.moxfieldApi, archidektApi: sites.archidektApi });

  beforeAll(async () => {
    sites = await startFakeDeckSites();
  });

  afterAll(async () => {
    await sites.close();
  });

  it('reads a Moxfield deck, leaving out the maybeboard', async () => {
    const deck = await fetchDeck('https://moxfield.com/decks/Y8dZ7', options());
    expect(deck).toEqual({
      name: 'Atraxa Counters',
      commanders: [{ name: "Atraxa, Praetors' Voice", count: 1 }],
      cards: [
        { name: 'Sol Ring', count: 1 },
        { name: 'Rhystic Study', count: 1 },
      ],
      sideboard: [],
    });
  });

  it('reads an Archidekt deck, leaving out categories that are not in the deck', async () => {
    const deck = await fetchDeck('https://archidekt.com/decks/42/delver_tribal', options());
    expect(deck.name).toBe('Delver Tribal');
    expect(deck.commanders).toEqual([{ name: "Atraxa, Praetors' Voice", count: 1 }]);
    expect(deck.cards).toEqual([{ name: 'Delver of Secrets // Insectile Aberration', count: 1 }]);
  });

  it('says so when a deck is missing or private', async () => {
    await expect(fetchDeck('https://moxfield.com/decks/nope', options())).rejects.toThrow("doesn't have that deck");
  });

  it('only takes links to sites it knows', async () => {
    await expect(fetchDeck('https://example.com/decks/1', options())).rejects.toBeInstanceOf(UnsupportedDeckLinkError);
    expect(isDeckLink('https://moxfield.com/decks/Y8dZ7')).toBe(true);
    expect(isDeckLink('1 Sol Ring\n1 Rhystic Study')).toBe(false);
  });
});
