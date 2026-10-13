import type { RawDeck, RawDeckEntry } from '@commander-brawl/application';

/** Reading decks from deck-building sites. Their APIs aren't official and may change; pasting a list always works. */

export interface DeckSitesOptions {
  readonly appVersion: string;
  /**
   * How to make requests. Moxfield sits behind Cloudflare, which turns away Node's own fetch but lets
   * a browser's network stack through, so the desktop app passes Electron's net.fetch.
   */
  readonly fetch?: (url: string, init: RequestInit) => Promise<Response>;
  /** Stand-ins for the sites, for tests. */
  readonly moxfieldApi?: string;
  readonly archidektApi?: string;
}

export class UnsupportedDeckLinkError extends Error {
  constructor() {
    super('Paste a Moxfield or Archidekt link, or the deck list itself.');
    this.name = 'UnsupportedDeckLinkError';
  }
}

/** Whether the text is a link (to try fetching) rather than a deck list (to read). */
export function isDeckLink(text: string): boolean {
  return /^https?:\/\/\S+$/i.test(text.trim());
}

export async function fetchDeck(link: string, options: DeckSitesOptions): Promise<RawDeck> {
  const url = new URL(link.trim());
  const moxfield = url.hostname.endsWith('moxfield.com') && url.pathname.match(/^\/decks\/([\w-]+)/);
  if (moxfield) return fetchMoxfield(moxfield[1]!, options);
  const archidekt = url.hostname.endsWith('archidekt.com') && url.pathname.match(/^\/(?:api\/)?decks\/(\d+)/);
  if (archidekt) return fetchArchidekt(archidekt[1]!, options);
  throw new UnsupportedDeckLinkError();
}

interface MoxfieldBoard {
  readonly cards?: Record<string, { readonly quantity?: number; readonly card?: { readonly name?: string } }>;
}

async function fetchMoxfield(id: string, options: DeckSitesOptions): Promise<RawDeck> {
  const api = options.moxfieldApi ?? 'https://api2.moxfield.com';
  const deck = await getJson<{ name?: string; boards?: Record<string, MoxfieldBoard> }>(
    `${api}/v3/decks/all/${encodeURIComponent(id)}`,
    options,
    'Moxfield',
  );
  const entries = (board: MoxfieldBoard | undefined): RawDeckEntry[] =>
    Object.values(board?.cards ?? {}).flatMap((entry) =>
      entry.card?.name ? [{ name: entry.card.name, count: entry.quantity ?? 1 }] : [],
    );
  return {
    name: deck.name ?? null,
    commanders: entries(deck.boards?.commanders),
    cards: entries(deck.boards?.mainboard),
    sideboard: [],
  };
}

interface ArchidektDeck {
  readonly name?: string;
  readonly categories?: readonly { readonly name?: string; readonly includedInDeck?: boolean }[];
  readonly cards?: readonly {
    readonly quantity?: number;
    readonly categories?: readonly string[] | null;
    readonly card?: { readonly oracleCard?: { readonly name?: string } };
  }[];
}

async function fetchArchidekt(id: string, options: DeckSitesOptions): Promise<RawDeck> {
  const api = options.archidektApi ?? 'https://archidekt.com';
  const deck = await getJson<ArchidektDeck>(`${api}/api/decks/${id}/`, options, 'Archidekt');
  // Categories like "Maybeboard" are kept out of the deck itself.
  const outside = new Set(
    (deck.categories ?? []).filter((c) => c.includedInDeck === false).map((c) => c.name?.toLowerCase()),
  );
  const commanders: RawDeckEntry[] = [];
  const cards: RawDeckEntry[] = [];
  for (const entry of deck.cards ?? []) {
    const name = entry.card?.oracleCard?.name;
    if (!name) continue;
    const categories = (entry.categories ?? []).map((c) => c.toLowerCase());
    // A card's first category decides where it counts.
    if (categories[0] !== undefined && outside.has(categories[0])) continue;
    const target = categories.includes('commander') ? commanders : cards;
    target.push({ name, count: entry.quantity ?? 1 });
  }
  return { name: deck.name ?? null, commanders, cards, sideboard: [] };
}

async function getJson<T>(url: string, options: DeckSitesOptions, site: string): Promise<T> {
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(url, {
      headers: {
        'User-Agent': `CommanderBrawl/${options.appVersion} (+https://github.com/Entex/commander-brawl)`,
        Accept: 'application/json',
      },
    });
  } catch {
    throw new Error(`Couldn't reach ${site}. Check your internet connection, or paste the deck list instead.`);
  }
  if (response.status === 404) throw new Error(`${site} doesn't have that deck. Is it private?`);
  if (!response.ok) throw new Error(`${site} answered ${response.status}. Try pasting the deck list instead.`);
  return (await response.json()) as T;
}
