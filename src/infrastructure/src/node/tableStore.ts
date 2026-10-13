import type { LoggedEvent, SavedMember } from '@commander-brawl/application';
import { appendFileSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isPlayer, toLoggedEvent } from '../protocol';

/** Where the table server keeps what it needs to come back after the host's app restarts. */
export interface TableStore {
  membersChanged(members: readonly SavedMember[]): void;
  /** Called before the event goes out to anyone, so a crash can't lose an event the players already have. */
  eventAdded(entry: LoggedEvent): void;
}

export interface TableMeta {
  readonly secret: string;
  readonly port: number;
  /** The host's own name and resume token, so they get their own seat back too. */
  readonly playerName: string;
  readonly ownResumeToken: string | null;
}

export interface SavedTable extends TableMeta {
  /** When the table last changed, in milliseconds since 1970. */
  readonly savedAt: number;
  readonly members: readonly SavedMember[];
  readonly entries: readonly LoggedEvent[];
}

/** A table nobody has touched for this long is over. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Saves a hosted table in a folder: table.json for who's at the table, and log.jsonl with one game
 * event per line. Events are appended (cheap and safe for long games); everything else is rewritten.
 */
export class FileTableStore implements TableStore {
  private meta: TableMeta | null = null;
  private members: readonly SavedMember[] = [];

  constructor(private readonly dir: string) {}

  /** The saved table, or null if there isn't one, it's broken, or it's more than a day old. */
  static async load(dir: string, now = Date.now()): Promise<SavedTable | null> {
    try {
      const raw: unknown = JSON.parse(await readFile(join(dir, 'table.json'), 'utf8'));
      const table = toSavedTable(raw);
      if (!table) return null;
      const lines = await readFile(join(dir, 'log.jsonl'), 'utf8').catch(() => '');
      const entries: LoggedEvent[] = [];
      for (const line of lines.split('\n')) {
        if (!line.trim()) continue;
        // A torn last line from a crash ends the log; everything before it is good.
        const entry = parseLine(line);
        if (!entry || entry.seq !== entries.length) break;
        entries.push(entry);
      }
      const savedAt = Math.max(table.savedAt, entries.at(-1)?.at ?? 0);
      if (now - savedAt > MAX_AGE_MS) return null;
      return { ...table, savedAt, entries };
    } catch {
      return null;
    }
  }

  /** Starts saving a new table, replacing whatever was saved before. */
  begin(meta: TableMeta): void {
    this.clear();
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(join(this.dir, 'log.jsonl'), '');
    this.meta = meta;
    this.members = [];
    this.writeTable();
  }

  /** Keeps saving a table that was loaded, adding to its log. */
  continue(table: SavedTable, meta: TableMeta): void {
    this.meta = meta;
    this.members = table.members;
    this.writeTable();
  }

  updateMeta(change: Partial<TableMeta>): void {
    if (!this.meta) return;
    this.meta = { ...this.meta, ...change };
    this.writeTable();
  }

  membersChanged(members: readonly SavedMember[]): void {
    this.members = members;
    this.writeTable();
  }

  eventAdded(entry: LoggedEvent): void {
    if (!this.meta) return;
    appendFileSync(join(this.dir, 'log.jsonl'), `${JSON.stringify(entry)}\n`);
  }

  /** The table is over: forget it. */
  clear(): void {
    this.meta = null;
    rmSync(this.dir, { recursive: true, force: true });
  }

  private writeTable(): void {
    if (!this.meta) return;
    const file = join(this.dir, 'table.json');
    // Write a new file and swap it in, so a crash mid-write never leaves half a file.
    writeFileSync(`${file}.tmp`, JSON.stringify({ ...this.meta, savedAt: Date.now(), members: this.members }));
    renameSync(`${file}.tmp`, file);
  }
}

function parseLine(line: string): LoggedEvent | null {
  try {
    return toLoggedEvent(JSON.parse(line));
  } catch {
    return null;
  }
}

function toSavedTable(raw: unknown): Omit<SavedTable, 'entries'> | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { secret, port, playerName, ownResumeToken, savedAt, members } = raw as Record<string, unknown>;
  const valid =
    typeof secret === 'string' &&
    typeof port === 'number' &&
    Number.isInteger(port) &&
    typeof playerName === 'string' &&
    (ownResumeToken === null || typeof ownResumeToken === 'string') &&
    typeof savedAt === 'number' &&
    Array.isArray(members) &&
    members.every(
      (m: unknown) =>
        typeof m === 'object' &&
        m !== null &&
        isPlayer((m as SavedMember).player) &&
        typeof (m as SavedMember).resumeToken === 'string',
    );
  if (!valid) return null;
  return { secret, port, playerName, ownResumeToken, savedAt, members: members as SavedMember[] };
}
