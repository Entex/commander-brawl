// Sign after packaging. Keep the private key outside the repository, in the release environment's secret store.
import { createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { RELEASE_PUBLIC_KEYS } from '../src/infrastructure/src/node/releaseKeys.ts';

const root = resolve(import.meta.dirname, '..');
const privatePem = process.env.CB_RELEASE_SIGNING_KEY;
if (!privatePem) throw new Error('CB_RELEASE_SIGNING_KEY is required to sign a release.');
const key = createPrivateKey(privatePem);
if (key.asymmetricKeyType !== 'ed25519') throw new Error('The release signing key must be Ed25519.');
const publicDer = createPublicKey(key).export({ type: 'spki', format: 'der' });
if (
  !RELEASE_PUBLIC_KEYS.some((pem) => createPublicKey(pem).export({ type: 'spki', format: 'der' }).equals(publicDer))
) {
  throw new Error('The signing key does not match a public key bundled with the app.');
}
const { version } = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const sums = await readFile(resolve(root, 'release/SHA256SUMS'), 'utf8');
const signature = sign(null, Buffer.from(`Commander Brawl release ${version}\n${sums}`, 'utf8'), key);
await writeFile(resolve(root, 'release/SHA256SUMS.sig'), `${signature.toString('base64')}\n`);
console.log(`Signed Commander Brawl ${version} checksums.`);
