import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';

/**
 * Empty folders for a test file's tests, removed after its last test. Call once at the top of the file (or a
 * describe block); use what it returns to make the folders.
 */
export function temporaryDirs(): (prefix: string) => Promise<string> {
  const made: string[] = [];
  afterAll(async () => {
    // A detached Windows installer can briefly retain its working directory after writing its final output.
    await Promise.all(
      made.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })),
    );
  });
  return async (prefix) => {
    const dir = await mkdtemp(join(tmpdir(), prefix));
    made.push(dir);
    return dir;
  };
}
