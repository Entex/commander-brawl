import type { Combo, DeckAnalysis, DeckList } from '@commander-brawl/domain';

/** Commander Spellbook: an open database of combos, which also knows what matters for brackets. */

export interface SpellbookOptions {
  readonly appVersion: string;
  /** A stand-in for the API, for tests. */
  readonly apiUrl?: string;
  readonly fetch?: (url: string, init: RequestInit) => Promise<Response>;
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

/** Game Changers, mass land denial, extra turns and two-card combos in the deck. */
export async function analyzeDeck(deck: DeckList, options: SpellbookOptions): Promise<DeckAnalysis> {
  const api = options.apiUrl ?? 'https://backend.commanderspellbook.com';
  const toEntry = (card: { name: string; count: number }) => ({ card: card.name, quantity: card.count });
  const response = await (options.fetch ?? fetch)(`${api}/estimate-bracket`, {
    method: 'POST',
    headers: {
      'User-Agent': `CommanderBrawl/${options.appVersion} (+https://github.com/Entex/commander-brawl)`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ commanders: deck.commanders.map(toEntry), main: deck.cards.map(toEntry) }),
  });
  if (!response.ok) throw new Error(`Commander Spellbook answered ${response.status}`);
  const estimate = (await response.json()) as EstimateResponse;

  const named = (flag: 'gameChanger' | 'massLandDenial' | 'extraTurn') =>
    (estimate.cards ?? []).flatMap((c) => (c[flag] && c.card?.name ? [c.card.name] : []));
  const twoCardCombos: Combo[] = (estimate.combos ?? [])
    .filter((c) => c.definitelyTwoCard)
    .map((c) => ({
      cards: (c.combo?.uses ?? []).flatMap((u) => (u.card?.name ? [u.card.name] : [])),
      produces: (c.combo?.produces ?? []).flatMap((p) => (p.feature?.name ? [p.feature.name] : [])).slice(0, 6),
    }))
    .filter((c) => c.cards.length > 0)
    .slice(0, 50);

  return {
    gameChangers: named('gameChanger'),
    massLandDenial: named('massLandDenial'),
    extraTurns: named('extraTurn'),
    twoCardCombos,
    complete: true,
  };
}
