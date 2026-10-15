import {
  MAX_COMMANDERS,
  MAX_DECK_ENTRIES,
  MAX_DECK_NAME_LENGTH,
  type Card,
  type DeckCard,
  type DeckList,
  type Printing,
} from '@commander-brawl/domain';

/** A deck as written down: names and counts, before we know which cards they are. */
export interface RawDeck {
  readonly name: string | null;
  readonly commanders: readonly RawDeckEntry[];
  readonly cards: readonly RawDeckEntry[];
  /** MTGO-style exports put the commander here, so it's kept aside in case the list names no commander. */
  readonly sideboard: readonly RawDeckEntry[];
}

export interface RawDeckEntry {
  readonly name: string;
  readonly count: number;
  /** The printing, when the list names it: "1x Sol Ring (CMM) 400". */
  readonly printing?: Printing;
}

export interface ImportedDeck {
  readonly deck: DeckList;
  /** Names that didn't match any card, so the player can fix them. */
  readonly unknown: readonly string[];
  /** Legendary cards in the deck, to choose a commander from when the list didn't say. */
  readonly commanderCandidates: readonly DeckCard[];
}

type Section = 'commander' | 'main' | 'sideboard' | 'skip';

const SECTION_HEADERS: readonly [RegExp, Section][] = [
  [/^(commanders?|command zone)$/, 'commander'],
  [/^(deck|main ?deck|main ?board|mainboard|main|library|companions?)$/, 'main'],
  [/^(side ?board|sideboard)$/, 'sideboard'],
  [/^(maybe ?board|maybeboard|maybe|considering|tokens?|attractions|stickers)$/, 'skip'],
];

/**
 * Reads a deck list the way the deck sites and MTGO/Arena export them, line by line:
 * "1 Sol Ring", "1x Sol Ring (CMM) 400", "Sol Ring *F*", "1 Atraxa, Praetors' Voice *CMDR*",
 * sections like "Commander", "// Sideboard" or "Deck (99)", and Archidekt's "[Commander{top}]" categories.
 */
export function parseDeckText(text: string): RawDeck {
  const commanders: RawDeckEntry[] = [];
  const cards: RawDeckEntry[] = [];
  const sideboard: RawDeckEntry[] = [];
  let section: Section = 'main';
  let name: string | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const nameMatch = line.match(/^(?:\/\/\s*)?name\s*[:=]\s*(.+)$/i);
    if (nameMatch) {
      name = nameMatch[1]!.trim();
      continue;
    }
    const header = sectionOf(line);
    if (header) {
      section = header;
      continue;
    }
    if (line.startsWith('//') || line.startsWith('#')) continue;

    const entry = parseLine(line);
    if (!entry) continue;
    if (entry.skip) continue;
    if (entry.commander || section === 'commander') commanders.push(entry);
    else if (section === 'main') cards.push(entry);
    else if (section === 'sideboard') sideboard.push(entry);
  }
  return { name, commanders, cards, sideboard };
}

/**
 * Matches the names to cards. Commanders the list didn't mark can be chosen from the legendary cards.
 * A deck without a name is named for its commanders, the way players talk about decks ("Atraxa").
 */
export function resolveDeck(
  raw: RawDeck,
  lookup: (name: string) => Card | undefined,
  fallbackName: string,
): ImportedDeck {
  const unknown: string[] = [];
  const resolve = (entries: readonly RawDeckEntry[]): DeckCard[] => {
    const byId = new Map<string, DeckCard>();
    for (const entry of entries) {
      const card = lookup(entry.name);
      if (!card) {
        unknown.push(entry.name);
        continue;
      }
      const existing = byId.get(card.id);
      const printing = existing?.printing ?? entry.printing;
      byId.set(card.id, {
        id: card.id,
        name: card.name,
        count: (existing?.count ?? 0) + entry.count,
        ...(printing ? { printing } : {}),
      });
    }
    return [...byId.values()];
  };

  let commanders = resolve(raw.commanders).slice(0, MAX_COMMANDERS);
  if (commanders.length === 0 && raw.sideboard.length > 0 && raw.sideboard.length <= MAX_COMMANDERS) {
    const fromSideboard = raw.sideboard.map((e) => lookup(e.name));
    if (fromSideboard.every((card) => card !== undefined && couldBeCommander(card))) {
      commanders = resolve(raw.sideboard);
    }
  }
  const commanderIds = new Set(commanders.map((c) => c.id));
  const cards = resolve(raw.cards)
    .filter((c) => !commanderIds.has(c.id))
    .slice(0, MAX_DECK_ENTRIES);
  const commanderCandidates =
    commanders.length > 0
      ? []
      : cards.filter((c) => {
          const card = lookup(c.name);
          return card !== undefined && couldBeCommander(card);
        });
  const name = (raw.name?.trim() || commanderNames(commanders) || fallbackName).slice(0, MAX_DECK_NAME_LENGTH);
  return { deck: { name, commanders, cards }, unknown: [...new Set(unknown)], commanderCandidates };
}

/** "Atraxa" for Atraxa, Praetors' Voice; "Tymna & Thrasios" for partners. */
function commanderNames(commanders: readonly DeckCard[]): string {
  return commanders.map((c) => c.name.split(' // ')[0]!.split(',')[0]!.trim()).join(' & ');
}

/** Moves the chosen cards from the deck into the command zone. */
export function chooseCommanders(deck: DeckList, ids: readonly string[]): DeckList {
  const chosen = ids.slice(0, MAX_COMMANDERS);
  const all = [...deck.commanders, ...deck.cards];
  const commanders = chosen.flatMap((id) => {
    const card = all.find((c) => c.id === id);
    return card ? [{ ...card, count: 1 }] : [];
  });
  const cards = all.map((c) => (chosen.includes(c.id) ? { ...c, count: c.count - 1 } : c)).filter((c) => c.count > 0);
  return { ...deck, commanders, cards };
}

/** Legendary creatures, and cards that say they can be your commander. */
export function couldBeCommander(card: Card): boolean {
  const front = card.faces[0] ?? card;
  return (
    (/\bLegendary\b/.test(front.typeLine) && /\b(Creature|Background)\b/.test(front.typeLine)) ||
    /can be your commander/i.test(card.oracleText)
  );
}

function sectionOf(line: string): Section | null {
  // "// Commander", "Commander:", "Deck (99)", "SIDEBOARD:"
  const label = line
    .replace(/^\/\/\s*/, '')
    .replace(/\s*\(\d+\)\s*$/, '')
    .replace(/:\s*$/, '')
    .trim()
    .toLowerCase();
  for (const [pattern, section] of SECTION_HEADERS) if (pattern.test(label)) return section;
  return null;
}

interface ParsedLine extends RawDeckEntry {
  readonly commander: boolean;
  readonly skip: boolean;
}

function parseLine(line: string): ParsedLine | null {
  let rest = line;
  let count = 1;
  const counted = rest.match(/^(\d+)\s*x?\s+(.+)$/i);
  if (counted) {
    count = Number(counted[1]);
    rest = counted[2]!;
  }

  // Archidekt's text export: "[Commander{top}]", "[Maybeboard{noDeck}{noPrice}]", "[Ramp,Removal]".
  let commander = false;
  let skip = false;
  const categories = rest.match(/\[([^\]]*)\]\s*$/);
  if (categories) {
    const text = categories[1]!;
    commander = /\bcommander\b/i.test(text);
    skip = /\{noDeck\}/i.test(text) || /^(maybeboard|sideboard)\b/i.test(text);
    rest = rest.slice(0, categories.index).trim();
  }
  if (/\*CMDR\*/i.test(rest)) commander = true;

  const bare = rest
    .replace(/\s*\*[A-Z]+\*/gi, '') // *F*, *E*, *CMDR*
    .replace(/\s*\^[^^]*\^/g, ''); // Archidekt tags
  // The printing: "(CMM) 400".
  const printed = bare.match(/\s*\(([A-Z0-9]{2,6})\)(?:\s+([\w★-]{1,10}))?\s*$/i);
  const printing = printed?.[2] ? { set: printed[1]!.toLowerCase(), number: printed[2] } : undefined;
  const name = bare
    .replace(/\s*\([A-Z0-9]{2,6}\)(\s+[\w★-]+)?\s*$/i, '') // (CMM) 400
    .replace(/\s*\[[A-Z0-9]{2,6}\]\s*$/i, '') // [CMM]
    .trim();
  if (!name || count < 1 || count > 99) return null;
  return printing ? { name, count, commander, skip, printing } : { name, count, commander, skip };
}
