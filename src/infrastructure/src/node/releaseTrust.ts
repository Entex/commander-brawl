import { createPublicKey, verify } from 'node:crypto';
import { RELEASE_PUBLIC_KEYS } from './releaseKeys';

export function hasReleaseSigningKey(): boolean {
  return RELEASE_PUBLIC_KEYS.length > 0;
}

/** Authenticate both the version and its checksums before downloading or executing release files. */
export function verifyReleaseChecksums(
  sums: string,
  signature: string,
  version: string,
  publicKeys: readonly string[] = RELEASE_PUBLIC_KEYS,
): void {
  const encoded = signature.trim();
  const bytes = Buffer.from(encoded, 'base64');
  const payload = Buffer.from(`Commander Brawl release ${version}\n${sums}`, 'utf8');
  if (
    bytes.length === 64 &&
    bytes.toString('base64') === encoded &&
    publicKeys.some((pem) => {
      const key = createPublicKey(pem);
      return key.asymmetricKeyType === 'ed25519' && verify(null, payload, key, bytes);
    })
  ) {
    return;
  }
  throw new Error('The release signature is missing or untrusted. No update files were installed.');
}
