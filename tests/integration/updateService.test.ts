import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UpdateService } from '../../src/desktop/src/main/updateService';
import { temporaryDirs } from '../support/temporaryDirs';
import { startFakeGitHub } from '../support/fakeGitHub';

const trust = vi.hoisted(() => ({ publicKeys: [] as string[] }));
vi.mock('../../src/infrastructure/src/node/releaseKeys', () => ({ RELEASE_PUBLIC_KEYS: trust.publicKeys }));
const installer = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('@commander-brawl/infrastructure/node', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@commander-brawl/infrastructure/node')>()),
  startInstaller: installer,
}));

const temporaryDir = temporaryDirs();
const closing: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
  trust.publicKeys.length = 0;
  installer.mockClear();
});

async function setup(
  options: { key?: boolean; signature?: boolean; tamper?: boolean; replace?: 'installer' | 'archive' } = {},
) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  if (options.key !== false) trust.publicKeys.push(publicKey.export({ format: 'pem', type: 'spki' }).toString());
  const script = Buffer.from('a signed installer');
  const archive = Buffer.from('a signed app');
  const sums =
    [
      [script, 'install.ps1'],
      [archive, 'commander-brawl-win32-x64.zip'],
    ]
      .map(([data, name]) => `${createHash('sha256').update(data!).digest('hex')}  ${name}`)
      .join('\n') + '\n';
  const signature = sign(null, Buffer.from(`Commander Brawl release 0.3.0\n${sums}`), privateKey).toString('base64');
  const github = await startFakeGitHub({
    version: '0.3.0',
    files: {
      'install.ps1': options.replace === 'installer' ? Buffer.from('replacement installer') : script,
      'commander-brawl-win32-x64.zip': options.replace === 'archive' ? Buffer.from('replacement archive') : archive,
      SHA256SUMS: Buffer.from(options.tamper ? sums.replace(/[a-f0-9]/, 'x') : sums),
      ...(options.signature !== false ? { 'SHA256SUMS.sig': Buffer.from(signature) } : {}),
    },
  });
  closing.push(() => github.close());
  const root = await temporaryDir('cb-update-service-');
  await mkdir(join(root, 'app'));
  await writeFile(join(root, 'app', 'app-version'), '0.2.3\n');
  const quit = vi.fn();
  const requests: string[] = [];
  const service = new UpdateService({
    appVersion: '0.2.3',
    dataDir: root,
    executable: join(root, 'app/commander-brawl.exe'),
    platform: 'win32',
    arch: 'x64',
    apiUrl: github.apiUrl,
    fetch: (url, init) => {
      requests.push(url);
      return fetch(url, init);
    },
    emit: () => undefined,
    quit,
  });
  await service.start();
  return { service, requests, quit, root };
}

describe('verified in-app updates', () => {
  it('offers manual installation when no trust key is bundled', async () => {
    const { service, quit, requests } = await setup({ key: false });
    expect(service.status()).toMatchObject({ state: 'available', canInstall: false });
    await expect(service.install()).rejects.toThrow("can't update itself");
    expect(requests).toHaveLength(1);
    expect(installer).not.toHaveBeenCalled();
    expect(quit).not.toHaveBeenCalled();
  });

  it('does not run an unsigned release even when a key is bundled', async () => {
    const { service } = await setup({ signature: false });
    expect(service.status()).toMatchObject({ state: 'available', canInstall: false });
    await expect(service.install()).rejects.toThrow("can't update itself");
    expect(installer).not.toHaveBeenCalled();
  });

  it('rejects a replaced manifest before downloading any executable content', async () => {
    const { service, requests, quit } = await setup({ tamper: true });
    await service.install();
    expect(service.status()).toMatchObject({ state: 'failed', message: expect.stringContaining('untrusted') });
    expect(requests.some((url) => url.endsWith('install.ps1') || url.endsWith('.zip'))).toBe(false);
    expect(installer).not.toHaveBeenCalled();
    expect(quit).not.toHaveBeenCalled();
  });

  it('authenticates the manifest and both hashes before handing files to the installer', async () => {
    const { service, quit, root } = await setup();
    await service.install();
    expect(service.status()).toMatchObject({ state: 'restarting', version: '0.3.0' });
    expect(await readFile(join(root, 'update/install.ps1'), 'utf8')).toBe('a signed installer');
    expect(await readFile(join(root, 'update/commander-brawl-win32-x64.zip'), 'utf8')).toBe('a signed app');
    expect(installer).toHaveBeenCalledOnce();
    expect(quit).toHaveBeenCalledOnce();
  });

  it.each(['installer', 'archive'] as const)(
    'rejects a replaced %s even with an authentic checksum manifest',
    async (replace) => {
      const { service, quit } = await setup({ replace });
      await service.install();
      expect(service.status()).toMatchObject({ state: 'failed', message: expect.stringContaining('checksum') });
      expect(installer).not.toHaveBeenCalled();
      expect(quit).not.toHaveBeenCalled();
    },
  );
});
