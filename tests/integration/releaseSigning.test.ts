import { verifyReleaseChecksums } from '@commander-brawl/infrastructure/node';
import { execFile } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { temporaryDirs } from '../support/temporaryDirs';

const temporaryDir = temporaryDirs();
const run = promisify(execFile);

async function setup() {
  const root = await temporaryDir('cb-signing-');
  const keys = generateKeyPairSync('ed25519');
  const publicPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privatePem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  await mkdir(join(root, 'scripts'));
  await mkdir(join(root, 'src/infrastructure/src/node'), { recursive: true });
  await mkdir(join(root, 'release'));
  await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module', version: '0.3.0' }));
  await writeFile(
    join(root, 'src/infrastructure/src/node/releaseKeys.ts'),
    `export const RELEASE_PUBLIC_KEYS: readonly string[] = ${JSON.stringify([publicPem])};\n`,
  );
  const sums = `${'a'.repeat(64)}  install.ps1\n`;
  await writeFile(join(root, 'release/SHA256SUMS'), sums);
  const script = join(root, 'scripts/sign-release.mjs');
  await copyFile(resolve(import.meta.dirname, '../../scripts/sign-release.mjs'), script);
  return { root, script, sums, publicPem, privatePem };
}

describe('release signing script', () => {
  it('produces a signature accepted by the app for the packaged version', async () => {
    const { root, script, sums, publicPem, privatePem } = await setup();
    await run(process.execPath, [script], { env: { ...process.env, CB_RELEASE_SIGNING_KEY: privatePem } });
    const signature = await readFile(join(root, 'release/SHA256SUMS.sig'), 'utf8');
    expect(() => verifyReleaseChecksums(sums, signature, '0.3.0', [publicPem])).not.toThrow();
  });

  it('refuses a private key that the packaged app does not trust', async () => {
    const { script } = await setup();
    const other = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    await expect(
      run(process.execPath, [script], { env: { ...process.env, CB_RELEASE_SIGNING_KEY: other } }),
    ).rejects.toThrow('does not match');
  });

  it('refuses to sign without a private key', async () => {
    const { script } = await setup();
    await expect(
      run(process.execPath, [script], { env: { ...process.env, CB_RELEASE_SIGNING_KEY: '' } }),
    ).rejects.toThrow('is required');
  });
});
