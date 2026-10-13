import type { RawDeck, RawDeckEntry } from '@commander-brawl/application';
import { MAX_COMBOS, type Combo, type DeckAnalysis, type DeckList } from '@commander-brawl/domain';

/**
 * Commander Spellbook: an open database of combos, which also knows what matters for brackets, and reads
 * decks from the deck-building sites' links (so we don't call each site's unofficial API ourselves).
 * Its API asks for a few requests per thing the player does, and for the app to say who it is.
 */

export interface SpellbookOptions {
  readonly appVersion: string;
  /** A stand-in for the API, for tests. */
  readonly apiUrl?: string;
  readonly fetch?: (url: string, init: RequestInit) => Promise<Response>;
}

/** The sites Commander Spellbook reads deck links from, by host name. */
const DECK_SITES: Readonly<Record<string, string>> = {
  'moxfield.com': 'Moxfield',
  'archidekt.com': 'Archidekt',
  'tappedout.net': 'TappedOut',
  'deckstats.net': 'Deckstats',
  'scryfall.com': 'Scryfall',
};

export class UnsupportedDeckLinkError extends Error {
  constructor() {
    super('Paste a link from Moxfield, Archidekt, TappedOut, Deckstats or Scryfall, or the deck list itself.');
    this.name = 'UnsupportedDeckLinkError';
  }
}

/** Whether the text is a link (to try fetching) rather than a deck list (to read). */
export function isDeckLink(text: string): boolean {
  return /^https?:\/\/\S+$/i.test(text.trim());
}

interface LinkedDeck {
  readonly commanders?: readonly { readonly card?: string; readonly quantity?: number }[];
  readonly main?: readonly { readonly card?: string; readonly quantity?: number }[];
}

/** The deck behind a link to a deck-building site. Spellbook doesn't say the deck's name. */
export async function fetchDeck(link: string, options: SpellbookOptions): Promise<RawDeck> {
  const url = new URL(link.trim());
  const site = DECK_SITES[url.hostname.toLowerCase().replace(/^www\./, '')];
  if (!site) throw new UnsupportedDeckLinkError();
  let response: Response;
  try {
    response = await request(`/card-list-from-url?url=${encodeURIComponent(url.href)}`, {}, options);
  } catch {
    throw new Error(
      `Couldn't reach Commander Spellbook, which reads ${site} decks. Check your internet connection, or paste the deck list instead.`,
    );
  }
  if (response.status === 400) {
    const { detail } = (await response.json().catch(() => ({}))) as { detail?: unknown };
    if (detail === 'Unsupported website') throw new UnsupportedDeckLinkError();
    if (detail === 'Decklist not available') throw new Error(`${site} doesn't have that deck. Is it private?`);
    throw new Error(`Commander Spellbook couldn't read that ${site} deck. Try pasting the deck list instead.`);
  }
  if (response.status === 429) {
    throw new Error('Commander Spellbook is busy. Try again in a minute, or paste the deck list instead.');
  }
  if (!response.ok)
    throw new Error(`Commander Spellbook answered ${response.status}. Try pasting the deck list instead.`);
  const deck = (await response.json()) as LinkedDeck;
  const entries = (list: LinkedDeck['main']): RawDeckEntry[] =>
    (list ?? []).flatMap((entry) => (entry.card ? [{ name: entry.card, count: entry.quantity ?? 1 }] : []));
  return { name: null, commanders: entries(deck.commanders), cards: entries(deck.main), sideboard: [] };
}

interface EstimateResponse {
  readonly cards?: readonly {
    readonly card?: { readonly name?: string };
    readonly gameChanger?: boolean;
    readonly massLandDenial?: boolean;
    readonly extraTurn?: boolean;
  }[];
  readonly combos?: readonly {
    readonly definitelyTwoCard?: boolean;
    readonly combo?: {
      readonly uses?: readonly { readonly card?: { readonly name?: string } }[];
      readonly produces?: readonly { readonly feature?: { readonly name?: string } }[];
    };
  }[];
}

/** Game Changers, mass land denial, extra turns and combos in the deck. */
export async function analyzeDeck(deck: DeckList, options: SpellbookOptions): Promise<DeckAnalysis> {
  const toEntry = (card: { name: string; count: number }) => ({ card: card.name, quantity: card.count });
  const response = await request(
    '/estimate-bracket',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commanders: deck.commanders.map(toEntry), main: deck.cards.map(toEntry) }),
    },
    options,
  );
  if (!response.ok) throw new Error(`Commander Spellbook answered ${response.status}`);
  const estimate = (await response.json()) as EstimateResponse;

  const named = (flag: 'gameChanger' | 'massLandDenial' | 'extraTurn') =>
    (estimate.cards ?? []).flatMap((c) => (c[flag] && c.card?.name ? [c.card.name] : []));
  const found = (estimate.combos ?? []).map((c) => ({
    twoCard: c.definitelyTwoCard === true,
    combo: {
      cards: (c.combo?.uses ?? []).flatMap((u) => (u.card?.name ? [u.card.name] : [])),
      produces: (c.combo?.produces ?? []).flatMap((p) => (p.feature?.name ? [p.feature.name] : [])).slice(0, 6),
    } satisfies Combo,
  }));
  const usable = found.filter((c) => c.combo.cards.length > 0);
  const twoCardCombos = usable
    .filter((c) => c.twoCard)
    .map((c) => c.combo)
    .slice(0, MAX_COMBOS);
  const combos = usable
    .map((c) => c.combo)
    .sort((a, b) => a.cards.length - b.cards.length)
    .slice(0, MAX_COMBOS);

  return {
    gameChangers: named('gameChanger'),
    massLandDenial: named('massLandDenial'),
    extraTurns: named('extraTurn'),
    twoCardCombos,
    combos,
    complete: true,
  };
}

function request(path: string, init: RequestInit, options: SpellbookOptions): Promise<Response> {
  const api = options.apiUrl ?? 'https://backend.commanderspellbook.com';
  return (options.fetch ?? fetch)(`${api}${path}`, {
    ...init,
    headers: {
      'User-Agent': `CommanderBrawl/${options.appVersion} (+https://github.com/Entex/commander-brawl)`,
      Accept: 'application/json',
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}
