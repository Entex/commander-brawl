import { toGameRecords, type GameRecord } from '@commander-brawl/application';
import { readFile, rename, writeFile } from 'node:fs/promises';

/**
 * Finished games, kept on this computer in one JSON file. Games are keyed by id (the table and the game's
 * number), so recording the same game again, or importing a friend's history, doesn't count it twice.
 */
export class FileHistoryStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly file: string) {}

  async list(): Promise<GameRecord[]> {
    await this.queue;
    return this.read();
  }

  /** Keeps these games, replacing any kept before with the same id. How many weren't kept before. */
  upsert(records: readonly GameRecord[]): Promise<number> {
    const result = this.queue.then(async () => {
      if (records.length === 0) return 0;
      const games = await this.read();
      const known = new Map(games.map((game, i) => [game.id, i]));
      let added = 0;
      for (const record of records) {
        const at = known.get(record.id);
        if (at === undefined) {
          known.set(record.id, games.length);
          games.push(record);
          added++;
        } else {
          games[at] = record;
        }
      }
      games.sort((a, b) => a.startedAt - b.startedAt);
      // Written aside and then moved over, so a crash halfway leaves the old file whole.
      await writeFile(`${this.file}.new`, JSON.stringify({ version: 1, games }), 'utf8');
      await rename(`${this.file}.new`, this.file);
      return added;
    });
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async read(): Promise<GameRecord[]> {
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8')) as { games?: unknown };
      return toGameRecords(raw.games);
    } catch {
      return [];
    }
  }
}
