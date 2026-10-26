import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, openSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream } from 'node:stream/web';

/**
 * Updates from the GitHub releases, done the way the install scripts do them: the app downloads the new version and
 * authenticates the version and checksums with a bundled release key, checks both downloads, then hands them to
 * that release's install script, which waits for the app to close, swaps the new version in (keeping the
 * previous one) and starts it.
 */

export const REPOSITORY = 'Entex/commander-brawl';

export interface UpdateOptions {
  readonly appVersion: string;
  /** GitHub's API, or a stand-in for tests. */
  readonly apiUrl?: string;
  readonly fetch?: (url: string, init: RequestInit) => Promise<Response>;
}

export interface Release {
  /** Like "0.2.0". */
  readonly version: string;
  /** The release's page, which says what's new. */
  readonly url: string;
  /** Where each file of the release downloads from, by name. */
  readonly files: ReadonlyMap<string, string>;
}

/** The newest published release, or null if there's none to see (none yet, or the repository is private). */
export async function latestRelease(options: UpdateOptions): Promise<Release | null> {
  const api = options.apiUrl ?? 'https://api.github.com';
  const response = await (options.fetch ?? fetch)(`${api}/repos/${REPOSITORY}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': userAgent(options.appVersion) },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
  const raw = (await response.json()) as {
    tag_name?: unknown;
    html_url?: unknown;
    assets?: readonly { name?: unknown; browser_download_url?: unknown }[];
  };
  if (typeof raw.tag_name !== 'string' || typeof raw.html_url !== 'string') return null;
  const files = new Map<string, string>();
  for (const asset of raw.assets ?? []) {
    if (typeof asset.name === 'string' && typeof asset.browser_download_url === 'string') {
      files.set(asset.name, asset.browser_download_url);
    }
  }
  return { version: raw.tag_name.replace(/^v/, ''), url: raw.html_url, files };
}

/** Whether `candidate` is a newer version than `current`: "0.10.0" is newer than "0.9.2", and "1.0.0" than "1.0.0-beta". */
export function isNewerVersion(candidate: string, current: string): boolean {
  const parse = (version: string) => {
    const [core = '', prerelease] = version.replace(/^v/, '').split('-', 2);
    return {
      parts: core.split('.').map((part) => Number.parseInt(part, 10) || 0),
      prerelease: prerelease !== undefined,
    };
  };
  const a = parse(candidate);
  const b = parse(current);
  for (let i = 0; i < Math.max(a.parts.length, b.parts.length); i++) {
    const difference = (a.parts[i] ?? 0) - (b.parts[i] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return b.prerelease && !a.prerelease;
}

/** The release file with the app for this kind of computer, as the install scripts name it. Null if there's none. */
export function archiveName(platform: NodeJS.Platform, arch: string): string | null {
  const target = `${platform}-${arch}`;
  if (!['win32-x64', 'darwin-arm64', 'darwin-x64', 'linux-x64'].includes(target)) return null;
  return `commander-brawl-${target}.${platform === 'win32' ? 'zip' : 'tar.gz'}`;
}

export function installScriptName(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'install.ps1' : 'install.sh';
}

/**
 * Where the install script put this app, from the app's own program file: the folder the script works in
 * (CB_INSTALL_DIR). Null if the app wasn't installed by the script (run from source, or unpacked by hand).
 */
export function installDir(executable: string, platform: NodeJS.Platform): string | null {
  if (platform === 'darwin') {
    // …/Commander Brawl.app/Contents/MacOS/commander-brawl
    const bundle = resolve(executable, '..', '..', '..');
    const installed =
      basename(bundle) === 'Commander Brawl.app' && existsSync(join(bundle, 'Contents', 'Resources', 'app-version'));
    return installed ? dirname(bundle) : null;
  }
  // …/app/commander-brawl(.exe), with the app-version file beside it
  const folder = dirname(executable);
  return basename(folder) === 'app' && existsSync(join(folder, 'app-version')) ? dirname(folder) : null;
}

/** The SHA-256 a release's SHA256SUMS gives for one of its files, or null if it doesn't list it. */
export function checksumFor(sums: string, name: string): string | null {
  for (const line of sums.split(/\r?\n/)) {
    const match = /^([0-9a-f]{64})\s+\*?(.+)$/i.exec(line.trim());
    if (match?.[2] === name) return match[1]!.toLowerCase();
  }
  return null;
}

export async function downloadText(url: string, options: UpdateOptions): Promise<string> {
  const response = await (options.fetch ?? fetch)(url, { headers: { 'User-Agent': userAgent(options.appVersion) } });
  if (!response.ok) throw new Error(`The download failed (${response.status}).`);
  return response.text();
}

/** Downloads a file and checks it against its SHA-256 on the way in. Reports progress from 0 to 1. */
export async function downloadChecked(
  url: string,
  file: string,
  sha256: string,
  options: UpdateOptions & { readonly onProgress?: (fraction: number) => void },
): Promise<void> {
  const response = await (options.fetch ?? fetch)(url, { headers: { 'User-Agent': userAgent(options.appVersion) } });
  if (!response.ok || !response.body) throw new Error(`The download failed (${response.status}).`);
  const total = Number(response.headers.get('content-length')) || 0;
  const hash = createHash('sha256');
  let received = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      received += chunk.length;
      if (total > 0) options.onProgress?.(Math.min(1, received / total));
      callback(null, chunk);
    },
  });
  await mkdir(dirname(file), { recursive: true });
  await pipeline(Readable.fromWeb(response.body as ReadableStream), counter, createWriteStream(file));
  if (hash.digest('hex') !== sha256.toLowerCase()) {
    await rm(file, { force: true });
    throw new Error('The download is damaged (its checksum is wrong). Try again.');
  }
}

export interface InstallerOptions {
  readonly platform: NodeJS.Platform;
  /** The release's install script, downloaded and checked. */
  readonly script: string;
  /** The new version's archive, downloaded and checked. */
  readonly archive: string;
  /** Where the app is installed (see installDir). */
  readonly installDir: string;
  /** Where the script's output goes, to tell what went wrong if it fails (see installerLogs). */
  readonly log: string;
}

/** The files an install script's output goes to: on Windows its errors go to a second one. */
export function installerLogs(log: string): string[] {
  return [log, `${log}.errors`];
}

/**
 * Starts the install script on its own, so it carries on once this app has closed: it waits for the app to close,
 * puts the new version in place (keeping the previous one), and starts it. If it fails, it starts the old one again.
 * Resolves once the script is running, after which the app may close.
 */
export function startInstaller(options: InstallerOptions): Promise<void> {
  const env = { ...process.env, CB_UPDATE: '1', CB_INSTALL_DIR: options.installDir, CB_ARCHIVE: options.archive };
  if (options.platform !== 'win32') {
    const output = openSync(options.log, 'w');
    const child = spawn('/bin/sh', [options.script, options.archive], {
      cwd: dirname(options.script),
      env,
      detached: true,
      stdio: ['ignore', output, output],
    });
    return new Promise((resolve, reject) => {
      child.once('spawn', () => {
        child.unref();
        resolve();
      });
      child.once('error', reject);
    });
  }
  // PowerShell started detached gets no console, and then quietly does nothing. So a short-lived PowerShell starts it
  // instead, hidden, with a console of its own. It's outside the job Node puts its children in (which ends them when
  // the app closes), because that job lets grandchildren break away.
  const powershell = join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  const [log, errors] = installerLogs(options.log) as [string, string];
  const quote = (text: string) => `'${text.replaceAll("'", "''")}'`;
  const command = [
    `Start-Process -FilePath ${quote(powershell)} -WindowStyle Hidden`,
    `-WorkingDirectory ${quote(dirname(options.script))}`,
    `-ArgumentList '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',${quote(`"${options.script}"`)}`,
    `-RedirectStandardOutput ${quote(log)} -RedirectStandardError ${quote(errors)}`,
  ].join(' ');
  const launcher = spawn(powershell, ['-NoProfile', '-NonInteractive', '-Command', command], {
    env,
    stdio: 'ignore',
    windowsHide: true,
  });
  return new Promise((resolve, reject) => {
    launcher.once('error', reject);
    launcher.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`The install script couldn't be started (${code}).`)),
    );
  });
}

/** What went wrong, from an install script's output: its "Error: …" line, or else its last line. */
export function installerError(log: string): string | null {
  const lines = log
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const error = lines.findLast((line) => line.startsWith('Error: '));
  return error?.slice('Error: '.length) ?? lines.at(-1) ?? null;
}

function userAgent(appVersion: string): string {
  return `CommanderBrawl/${appVersion} (+https://github.com/${REPOSITORY})`;
}
