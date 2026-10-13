import {
  archiveName,
  checksumFor,
  downloadChecked,
  installDir,
  installerError,
  isNewerVersion,
  latestRelease,
  startInstaller,
} from '@commander-brawl/infrastructure/node';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startFakeGitHub } from '../support/fakeGitHub';
import { temporaryDirs } from '../support/temporaryDirs';

const temporaryDir = temporaryDirs();
const closing: (() => void)[] = [];
afterEach(() => {
  for (const close of closing.splice(0)) close();
});

/** A fake GitHub for one release, closed after the test. */
async function fakeGitHub(files: Record<string, Buffer>, options: { noReleases?: boolean } = {}): Promise<string> {
  const github = await startFakeGitHub(options.noReleases ? null : { version: '0.2.0', files });
  closing.push(() => void github.close());
  return github.apiUrl;
}

const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

describe('finding a newer version', () => {
  it('compares versions by their numbers', () => {
    expect(isNewerVersion('0.2.0', '0.1.0')).toBe(true);
    expect(isNewerVersion('v0.10.0', '0.9.2')).toBe(true);
    expect(isNewerVersion('1.0.0', '1.0.0-beta')).toBe(true);
    expect(isNewerVersion('0.1.0', '0.1.0')).toBe(false);
    expect(isNewerVersion('0.1.0', '0.2.0')).toBe(false);
    expect(isNewerVersion('1.0.0-beta', '1.0.0')).toBe(false);
  });

  it('reads the latest release, and finds none when there is none to see', async () => {
    const api = await fakeGitHub({ SHA256SUMS: Buffer.from('') });
    const release = await latestRelease({ appVersion: '0.1.0', apiUrl: api });
    expect(release?.version).toBe('0.2.0');
    expect(release?.url).toBe('https://github.com/Entex/commander-brawl/releases/tag/v0.2.0');
    expect(release?.files.get('SHA256SUMS')).toBe(`${api}/download/SHA256SUMS`);

    // No releases yet, or a private repository: GitHub says there's nothing.
    const none = await fakeGitHub({}, { noReleases: true });
    expect(await latestRelease({ appVersion: '0.1.0', apiUrl: none })).toBeNull();
  });

  it('names the release file for this kind of computer, as the install scripts do', () => {
    expect(archiveName('win32', 'x64')).toBe('commander-brawl-win32-x64.zip');
    expect(archiveName('darwin', 'arm64')).toBe('commander-brawl-darwin-arm64.tar.gz');
    expect(archiveName('linux', 'arm64')).toBeNull();
  });
});

describe('downloading a new version', () => {
  it('keeps a download that matches its checksum, and throws away one that does not', async () => {
    const archive = Buffer.from('the new version');
    const api = await fakeGitHub({ 'commander-brawl-win32-x64.zip': archive });
    const sums = `${sha256(archive)}  commander-brawl-win32-x64.zip\n${'0'.repeat(64)}  install.ps1\n`;
    const expected = checksumFor(sums, 'commander-brawl-win32-x64.zip')!;
    expect(checksumFor(sums, 'install.sh')).toBeNull();

    const dir = await temporaryDir('cb-update-');
    const file = join(dir, 'app.zip');
    const progress: number[] = [];
    const url = `${api}/download/commander-brawl-win32-x64.zip`;
    await downloadChecked(url, file, expected, { appVersion: '0.1.0', onProgress: (p) => progress.push(p) });
    expect(await readFile(file, 'utf8')).toBe('the new version');
    expect(progress.at(-1)).toBe(1);

    await expect(downloadChecked(url, file, '0'.repeat(64), { appVersion: '0.1.0' })).rejects.toThrow('damaged');
    expect(existsSync(file)).toBe(false);
  });
});

describe('installing a new version', () => {
  it('knows where the install script put the app, and when it did not', async () => {
    const root = await temporaryDir('cb-installed-');
    await mkdir(join(root, 'app'));
    await writeFile(join(root, 'app', 'app-version'), '0.1.0\n');
    expect(installDir(join(root, 'app', 'commander-brawl.exe'), 'win32')).toBe(root);

    const bundle = join(root, 'Commander Brawl.app');
    await mkdir(join(bundle, 'Contents', 'Resources'), { recursive: true });
    await writeFile(join(bundle, 'Contents', 'Resources', 'app-version'), '0.1.0\n');
    expect(installDir(join(bundle, 'Contents', 'MacOS', 'commander-brawl'), 'darwin')).toBe(root);

    // Run from source, or unpacked by hand.
    expect(installDir(join(root, 'node_modules', 'electron', 'dist', 'electron.exe'), 'win32')).toBeNull();
  });

  it('starts the install script on its own, and reads what went wrong from its output', async () => {
    const dir = await temporaryDir('cb-installer-');
    const windows = process.platform === 'win32';
    const script = join(dir, windows ? 'install.ps1' : 'install.sh');
    await writeFile(
      script,
      windows
        ? 'Set-Content -Path (Join-Path $env:CB_INSTALL_DIR "ran.txt") -Value "$env:CB_UPDATE $env:CB_ARCHIVE"\nWrite-Host "Error: Could not unpack it."\n'
        : 'echo "$CB_UPDATE $1" > "$CB_INSTALL_DIR/ran.txt"\necho "Error: Could not unpack it." >&2\n',
    );
    const archive = join(dir, 'new.zip');
    const log = join(dir, 'install.log');
    await startInstaller({ platform: process.platform, script, archive, installDir: dir, log });

    const ran = join(dir, 'ran.txt');
    await expect.poll(() => existsSync(ran), { timeout: 15_000 }).toBe(true);
    expect((await readFile(ran, 'utf8')).trim()).toBe(`1 ${archive}`);
    await expect
      .poll(async () => installerError(await readFile(log, 'utf8')), { timeout: 15_000 })
      .toBe('Could not unpack it.');
  });

  it('finds the error in what the install script wrote', () => {
    expect(installerError("Unpacking...\nError: The archive doesn't contain the app.\nat line 3\n")).toBe(
      "The archive doesn't contain the app.",
    );
    expect(installerError('Unpacking...\nSomething odd\n')).toBe('Something odd');
    expect(installerError('')).toBeNull();
  });
});
