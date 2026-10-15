import type { Card, CardFace, CommanderLegality, Ruling } from '@commander-brawl/domain';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { Readable, Transform } from 'node:stream';
import { createGunzip } from 'node:zlib';

/**
 * Card data from Scryfall's bulk files. We download them about once a week instead of calling the
 * API for every search, as Scryfall asks, and keep a compact copy on this computer.
 */

export interface SavedCards {
  readonly cards: readonly Card[];
  /** When Scryfall last updated the data. */
  readonly updatedAt: string;
  /** When we downloaded it, in milliseconds since 1970. */
  readonly savedAt: number;
}

export interface ScryfallOptions {
  /** Folder for the downloaded data. */
  readonly dir: string;
  readonly appVersion: string;
  /** Scryfall's API, or a stand-in for tests. */
  readonly apiUrl?: string;
}

interface BulkEntry {
  readonly type: string;
  readonly updated_at: string;
  readonly jsonl_download_uri?: string;
  readonly compressed_size?: number;
}

/** Card layouts that aren't playable cards: art cards, oversized fronts, and Vanguard avatars. */
const SKIPPED_LAYOUTS = new Set(['art_series', 'front_card', 'vanguard']);
const IMAGE_PREFIX = /^https:\/\/cards\.scryfall\.io\/[a-z_]+\/(.+)$/;
const FORMAT_VERSION = 3;
/** Saved before artists (1) or keywords (2) were kept: still used, but replaced as soon as possible. */
const OLD_FORMAT_VERSIONS = [1, 2];

export class ScryfallCards {
  private rulingsByCard: Promise<Map<string, Ruling[]>> | null = null;

  constructor(private readonly options: ScryfallOptions) {}

  /** The cards saved on this computer, or null if there aren't any yet (or they're unreadable). */
  async loadSaved(): Promise<SavedCards | null> {
    try {
      const raw = JSON.parse(await readFile(join(this.options.dir, 'cards.json'), 'utf8')) as Record<string, unknown>;
      if (!Array.isArray(raw.cards)) return null;
      if (OLD_FORMAT_VERSIONS.includes(raw.version as number)) {
        const cards = (raw.cards as Card[]).map((card) => ({ ...card, artist: card.artist ?? null, keywords: [] }));
        return { cards, updatedAt: String(raw.updatedAt), savedAt: 0 };
      }
      if (raw.version !== FORMAT_VERSION) return null;
      return { cards: raw.cards as Card[], updatedAt: String(raw.updatedAt), savedAt: Number(raw.savedAt) };
    } catch {
      return null;
    }
  }

  /** Downloads the latest cards and rulings and saves them. Reports progress from 0 to 1. */
  async download(onProgress: (fraction: number) => void = () => undefined): Promise<SavedCards> {
    const bulk = await this.getJson<{ data: BulkEntry[] }>(`${this.apiUrl}/bulk-data`);
    const cardsEntry = findEntry(bulk.data, 'oracle_cards');
    const rulingsEntry = findEntry(bulk.data, 'rulings');
    const cardsSize = cardsEntry.compressed_size ?? 1;
    const rulingsSize = rulingsEntry.compressed_size ?? 1;
    const total = cardsSize + rulingsSize;

    const cards: Card[] = [];
    await this.readLines(
      cardsEntry.jsonl_download_uri!,
      (bytes) => onProgress(bytes / total),
      (line) => {
        const card = toCard(JSON.parse(line));
        if (card) cards.push(card);
      },
    );
    const rulings = new Map<string, Ruling[]>();
    await this.readLines(
      rulingsEntry.jsonl_download_uri!,
      (bytes) => onProgress((cardsSize + bytes) / total),
      (line) => {
        const ruling = JSON.parse(line) as { oracle_id?: unknown; published_at?: unknown; comment?: unknown };
        if (typeof ruling.oracle_id !== 'string' || typeof ruling.comment !== 'string') return;
        const list = rulings.get(ruling.oracle_id) ?? [];
        list.push({ date: String(ruling.published_at ?? ''), text: ruling.comment });
        rulings.set(ruling.oracle_id, list);
      },
    );

    const saved: SavedCards = { cards, updatedAt: cardsEntry.updated_at, savedAt: Date.now() };
    await mkdir(this.options.dir, { recursive: true });
    await writeAtomically(join(this.options.dir, 'rulings.json'), JSON.stringify(Object.fromEntries(rulings)));
    await writeAtomically(join(this.options.dir, 'cards.json'), JSON.stringify({ version: FORMAT_VERSION, ...saved }));
    this.rulingsByCard = Promise.resolve(rulings);
    onProgress(1);
    return saved;
  }

  /** Official rulings for a card, oldest first. Loaded the first time they're asked for. */
  async rulings(cardId: string): Promise<Ruling[]> {
    this.rulingsByCard ??= readFile(join(this.options.dir, 'rulings.json'), 'utf8')
      .then((text) => new Map(Object.entries(JSON.parse(text) as Record<string, Ruling[]>)))
      .catch(() => new Map());
    return (await this.rulingsByCard).get(cardId) ?? [];
  }

  private get apiUrl(): string {
    return this.options.apiUrl ?? 'https://api.scryfall.com';
  }

  /** Scryfall asks every app to say who it is. */
  private get headers(): Record<string, string> {
    return {
      'User-Agent': `CommanderBrawl/${this.options.appVersion} (+https://github.com/Entex/commander-brawl)`,
      Accept: 'application/json;q=0.9,*/*;q=0.8',
    };
  }

  private async getJson<T>(url: string): Promise<T> {
    const response = await fetch(url, { headers: this.headers });
    if (!response.ok) throw new Error(`Scryfall answered ${response.status} for ${url}`);
    return (await response.json()) as T;
  }

  /** Streams a gzipped JSON Lines file, one line at a time, without holding the whole file in memory. */
  private async readLines(
    url: string,
    onBytes: (bytes: number) => void,
    onLine: (line: string) => void,
  ): Promise<void> {
    const response = await fetch(url, { headers: this.headers });
    if (!response.ok || !response.body) throw new Error(`Scryfall answered ${response.status} for ${url}`);
    let received = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length;
        onBytes(received);
        callback(null, chunk);
      },
    });
    const body = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream).pipe(counter);
    const text = (await startsWithGzip(body)) ? body.pipe(createGunzip()) : body;
    for await (const line of createInterface({ input: text, crlfDelay: Number.POSITIVE_INFINITY })) {
      if (line.trim()) onLine(line);
    }
  }
}

/** Turns one Scryfall card object into our compact card, or null for things that aren't playable cards. */
export function toCard(raw: unknown): Card | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const c = raw as ScryfallCard;
  if (typeof c.oracle_id !== 'string' || typeof c.name !== 'string' || SKIPPED_LAYOUTS.has(c.layout ?? '')) return null;
  // Arena-only cards. (Some paper cards are represented by an MTGO printing, so being digital isn't enough.)
  if (c.digital === true && c.legalities?.commander !== 'legal' && c.legalities?.commander !== 'banned') return null;

  const rawFaces = Array.isArray(c.card_faces) ? c.card_faces : [];
  const faces: CardFace[] = rawFaces.map((face) => ({
    name: face.name ?? '',
    manaCost: face.mana_cost ?? '',
    typeLine: face.type_line ?? '',
    oracleText: face.oracle_text ?? '',
    stats: stats(face),
    image: imagePath(face.image_uris?.normal),
  }));
  return {
    id: c.oracle_id,
    name: c.name,
    layout: c.layout ?? 'normal',
    manaCost:
      c.mana_cost ??
      faces
        .map((f) => f.manaCost)
        .filter(Boolean)
        .join(' // '),
    typeLine: c.type_line ?? faces.map((f) => f.typeLine).join(' // '),
    oracleText: c.oracle_text ?? faces.map((f) => f.oracleText).join('\n\n'),
    stats: stats(c),
    colorIdentity: Array.isArray(c.color_identity) ? c.color_identity : [],
    manaValue: typeof c.cmc === 'number' ? c.cmc : 0,
    commander: toLegality(c.legalities?.commander),
    gameChanger: c.game_changer === true,
    image: imagePath(c.image_uris?.normal) ?? faces[0]?.image ?? null,
    // When each face has its own picture, the card's picture is the front's.
    artist: (c.image_uris ? c.artist : (rawFaces[0]?.artist ?? c.artist)) ?? null,
    faces,
    keywords: Array.isArray(c.keywords) ? c.keywords.filter((k): k is string => typeof k === 'string') : [],
  };
}

interface ScryfallFace {
  readonly name?: string;
  readonly mana_cost?: string;
  readonly type_line?: string;
  readonly oracle_text?: string;
  readonly power?: string;
  readonly toughness?: string;
  readonly loyalty?: string;
  readonly defense?: string;
  readonly artist?: string;
  readonly image_uris?: { readonly normal?: string };
}

interface ScryfallCard extends ScryfallFace {
  readonly oracle_id?: string;
  readonly layout?: string;
  readonly digital?: boolean;
  readonly card_faces?: readonly ScryfallFace[];
  readonly color_identity?: readonly string[];
  readonly cmc?: number;
  readonly legalities?: { readonly commander?: string };
  readonly game_changer?: boolean;
  readonly keywords?: readonly unknown[];
}

function stats(face: ScryfallFace): string {
  if (face.power !== undefined && face.toughness !== undefined) return `${face.power}/${face.toughness}`;
  if (face.loyalty !== undefined) return `Loyalty ${face.loyalty}`;
  if (face.defense !== undefined) return `Defense ${face.defense}`;
  return '';
}

/** Keeps just the part of an image address after the size, e.g. "front/a/4/a471….jpg?1783907750". */
function imagePath(url: string | undefined): string | null {
  return url?.match(IMAGE_PREFIX)?.[1] ?? null;
}

function toLegality(value: string | undefined): CommanderLegality {
  return value === 'legal' || value === 'banned' ? value : 'not_legal';
}

function findEntry(entries: readonly BulkEntry[], type: string): BulkEntry {
  const entry = entries.find((e) => e.type === type);
  if (!entry?.jsonl_download_uri) throw new Error(`Scryfall has no "${type}" file in the format we read.`);
  return entry;
}

/** Peeks at the first bytes: gzip files start with 1f 8b. Some servers unzip for us, some don't. */
async function startsWithGzip(stream: Readable): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const onReadable = () => {
      const chunk = stream.read(2) as Buffer | null;
      if (chunk === null) {
        if (stream.readableEnded) resolve(false);
        return;
      }
      stream.off('readable', onReadable);
      stream.off('end', onEnd);
      stream.unshift(chunk);
      resolve(chunk[0] === 0x1f && chunk[1] === 0x8b);
    };
    const onEnd = () => resolve(false);
    stream.on('readable', onReadable);
    stream.once('end', onEnd);
    stream.once('error', reject);
  });
}

async function writeAtomically(path: string, text: string): Promise<void> {
  await writeFile(`${path}.tmp`, text);
  await rename(`${path}.tmp`, path);
}
