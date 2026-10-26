import { verifyReleaseChecksums } from '@commander-brawl/infrastructure/node';
import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const pem = publicKey.export({ format: 'pem', type: 'spki' }).toString();
const sums = `${'a'.repeat(64)}  install.ps1\n${'b'.repeat(64)}  commander-brawl-win32-x64.zip\n`;
const version = '0.3.0';
const signature = sign(null, Buffer.from(`Commander Brawl release ${version}\n${sums}`), privateKey).toString('base64');

describe('release authentication', () => {
  it('accepts the exact version and checksums signed with a bundled key', () => {
    expect(() => verifyReleaseChecksums(sums, `${signature}\n`, version, [pem])).not.toThrow();
  });

  it('rejects replacement checksums even when they match replacement release files', () => {
    expect(() => verifyReleaseChecksums(sums.replace('a', 'c'), signature, version, [pem])).toThrow('untrusted');
  });

  it('rejects an older signed manifest relabeled as a newer release', () => {
    expect(() => verifyReleaseChecksums(sums, signature, '0.4.0', [pem])).toThrow('untrusted');
  });

  it('rejects a signature from a key downloaded with a replacement release', () => {
    const attacker = generateKeyPairSync('ed25519');
    const forged = sign(null, Buffer.from(`Commander Brawl release ${version}\n${sums}`), attacker.privateKey).toString(
      'base64',
    );
    expect(() => verifyReleaseChecksums(sums, forged, version, [pem])).toThrow('untrusted');
  });

  it.each(['', 'not a signature', 'A'.repeat(88), signature.slice(0, -4)])(
    'rejects a missing or invalid signature: %s',
    (invalid) => {
      expect(() => verifyReleaseChecksums(sums, invalid, version, [pem])).toThrow('untrusted');
    },
  );

  it('fails closed without a configured trust key', () => {
    expect(() => verifyReleaseChecksums(sums, signature, version, [])).toThrow('untrusted');
  });

  it('supports key rotation while retaining the old trusted key', () => {
    const next = generateKeyPairSync('ed25519').publicKey.export({ format: 'pem', type: 'spki' }).toString();
    expect(() => verifyReleaseChecksums(sums, signature, version, [next, pem])).not.toThrow();
  });
});
