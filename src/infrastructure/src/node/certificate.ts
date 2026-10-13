import { X509Certificate } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { generate } from 'selfsigned';

/** The app's own TLS certificate, used for the phone page and the table host. */
export interface TlsIdentity {
  readonly key: string;
  readonly cert: string;
  /** SHA-256 fingerprint as uppercase hex without separators. */
  readonly fingerprint: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
// Apple devices reject server certificates that are valid for longer than this.
const VALIDITY_DAYS = 397;
const RENEW_WHEN_DAYS_LEFT = 30;

/** Loads the certificate from dir, or creates a new one if it's missing or about to expire. */
export async function loadOrCreateIdentity(dir: string, addresses: readonly string[]): Promise<TlsIdentity> {
  const keyPath = join(dir, 'tls-key.pem');
  const certPath = join(dir, 'tls-cert.pem');
  try {
    const [key, cert] = await Promise.all([readFile(keyPath, 'utf8'), readFile(certPath, 'utf8')]);
    const x509 = new X509Certificate(cert);
    if (Date.parse(x509.validTo) - Date.now() > RENEW_WHEN_DAYS_LEFT * DAY_MS) {
      return { key, cert, fingerprint: fingerprintOf(x509) };
    }
  } catch {
    // Missing or unreadable: create a new one below.
  }
  const identity = await createIdentity(addresses);
  await mkdir(dir, { recursive: true });
  await writeFile(keyPath, identity.key, { mode: 0o600 });
  await writeFile(certPath, identity.cert);
  return identity;
}

export async function createIdentity(addresses: readonly string[]): Promise<TlsIdentity> {
  const now = Date.now();
  const pems = await generate([{ name: 'commonName', value: 'Commander Brawl' }], {
    keyType: 'ec',
    curve: 'P-256',
    algorithm: 'sha256',
    notBeforeDate: new Date(now - DAY_MS),
    notAfterDate: new Date(now + VALIDITY_DAYS * DAY_MS),
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, critical: true },
      { name: 'extKeyUsage', serverAuth: true },
      {
        name: 'subjectAltName',
        altNames: [{ type: 2, value: 'localhost' }, ...addresses.map((ip) => ({ type: 7 as const, ip }))],
      },
    ],
  });
  return { key: pems.private, cert: pems.cert, fingerprint: fingerprintOf(new X509Certificate(pems.cert)) };
}

export function fingerprintOf(cert: X509Certificate): string {
  return normalizeFingerprint(cert.fingerprint256);
}

export function normalizeFingerprint(fingerprint: string): string {
  return fingerprint.replaceAll(':', '').toUpperCase();
}
