import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { temporaryDirs } from '../support/temporaryDirs';

// The install scripts as the app runs them to update itself (CB_UPDATE=1), on a stand-in app in a folder of its own.

const temporaryDir = temporaryDirs();
const scripts = resolve(import.meta.dirname, '../../scripts');

/** An installed app at `version` (root/app), and an archive of `next`, laid out as the release packages are. */
async function setUp(next: { version: string; withApp: boolean }, app: (dir: string) => Promise<void>) {
  const dir = await temporaryDir('cb-install-');
  const root = join(dir, 'installed');
  await mkdir(join(root, 'app'), { recursive: true });
  await writeFile(join(root, 'app', 'app-version'), '0.1.0\n');
  await app(join(root, 'app'));
  const content = join(dir, 'archive', 'commander-brawl');
  await mkdir(content, { recursive: true });
  await writeFile(join(content, 'app-version'), `${next.version}\n`);
  if (next.withApp) await app(content);
  return {
    dir,
    root,
    version: (folder: string) => readFile(join(root, folder, 'app-version'), 'utf8').then((v) => v.trim()),
  };
}

describe.runIf(process.platform === 'linux')('install.sh updating the app', () => {
  /** A stand-in app: notes which version started, so the test can tell. */
  const fakeApp = async (dir: string) => {
    await writeFile(
      join(dir, 'commander-brawl'),
      '#!/bin/sh\ncp "$(dirname "$0")/app-version" "$CB_INSTALL_DIR/started"\n',
    );
    chmodSync(join(dir, 'commander-brawl'), 0o755);
  };

  const run = (dir: string, root: string) => {
    const archive = join(dir, 'commander-brawl-linux-x64.tar.gz');
    execFileSync('tar', ['-czf', archive, 'commander-brawl'], { cwd: join(dir, 'archive') });
    return spawnSync('sh', [join(scripts, 'install.sh'), archive], {
      env: { ...process.env, CB_UPDATE: '1', CB_INSTALL_DIR: root },
      encoding: 'utf8',
    });
  };

  it('puts the new version in place, keeps the previous one, and starts the new one', async () => {
    const { dir, root, version } = await setUp({ version: '0.2.0', withApp: true }, fakeApp);
    const result = run(dir, root);
    expect(result.status, result.stderr).toBe(0);
    expect(await version('app')).toBe('0.2.0');
    expect(await version('previous')).toBe('0.1.0');
    await expect.poll(() => existsSync(join(root, 'started'))).toBe(true);
    expect((await readFile(join(root, 'started'), 'utf8')).trim()).toBe('0.2.0');
    // The launchers are left alone.
    expect(result.stdout).not.toContain('app menu');
  });

  it('keeps the old version, and starts it again, when the new one is broken', async () => {
    const { dir, root, version } = await setUp({ version: '0.2.0', withApp: false }, fakeApp);
    const result = run(dir, root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error: The archive doesn't contain the app.");
    expect(await version('app')).toBe('0.1.0');
    await expect.poll(() => existsSync(join(root, 'started'))).toBe(true);
    expect((await readFile(join(root, 'started'), 'utf8')).trim()).toBe('0.1.0');
  });
});

describe.runIf(process.platform === 'win32')('install.ps1 updating the app', () => {
  /** A stand-in app that starts without showing anything and ends at once. */
  const fakeApp = (dir: string) =>
    copyFile(
      join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'rundll32.exe'),
      join(dir, 'commander-brawl.exe'),
    );

  const run = (dir: string, root: string) => {
    const archive = join(dir, 'commander-brawl-win32-x64.zip');
    execFileSync(
      join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'),
      ['-a', '-cf', archive, 'commander-brawl'],
      {
        cwd: join(dir, 'archive'),
      },
    );
    return spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(scripts, 'install.ps1')],
      { env: { ...process.env, CB_UPDATE: '1', CB_INSTALL_DIR: root, CB_ARCHIVE: archive }, encoding: 'utf8' },
    );
  };

  it('puts the new version in place and keeps the previous one', async () => {
    const { dir, root, version } = await setUp({ version: '0.2.0', withApp: true }, fakeApp);
    const result = run(dir, root);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(await version('app')).toBe('0.2.0');
    expect(await version('previous')).toBe('0.1.0');
  });

  it('keeps the old version when the new one is broken, and says why', async () => {
    const { dir, root, version } = await setUp({ version: '0.2.0', withApp: false }, fakeApp);
    const result = run(dir, root);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("Error: The archive doesn't contain the app.");
    expect(await version('app')).toBe('0.1.0');
  });
});
