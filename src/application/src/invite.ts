const PREFIX = 'CB1-';
const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const MAX_HOSTS = 8;

/** Everything a player needs to reach the host's table. Shared as a text code, e.g. pasted in Discord. */
export interface Invite {
  /** Addresses to try, in order of preference. */
  readonly hosts: readonly string[];
  readonly port: number;
  /** Shared password for the table. */
  readonly secret: string;
  /** SHA-256 fingerprint of the host's certificate as uppercase hex, used to make sure we reach the real host. */
  readonly fingerprint: string;
}

export class InvalidInviteError extends Error {
  constructor() {
    super('That invite code is not valid. Ask the host to copy it again.');
    this.name = 'InvalidInviteError';
  }
}

export function encodeInvite(invite: Invite): string {
  const json = JSON.stringify({ h: invite.hosts, p: invite.port, s: invite.secret, f: invite.fingerprint });
  return PREFIX + toBase64Url(json);
}

export function decodeInvite(code: string): Invite {
  const compact = code.replace(/\s+/g, '');
  if (!compact.startsWith(PREFIX)) {
    throw new InvalidInviteError();
  }
  let raw: unknown;
  try {
    raw = JSON.parse(fromBase64Url(compact.slice(PREFIX.length)));
  } catch {
    throw new InvalidInviteError();
  }
  if (typeof raw !== 'object' || raw === null) {
    throw new InvalidInviteError();
  }
  const { h, p, s, f } = raw as Record<string, unknown>;
  const validHosts =
    Array.isArray(h) &&
    h.length > 0 &&
    h.length <= MAX_HOSTS &&
    h.every((host) => typeof host === 'string' && host.length > 0 && host.length <= 64);
  const validPort = typeof p === 'number' && Number.isInteger(p) && p > 0 && p < 65536;
  const validSecret = typeof s === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(s);
  const validFingerprint = typeof f === 'string' && /^[0-9A-F]{64}$/.test(f);
  if (!validHosts || !validPort || !validSecret || !validFingerprint) {
    throw new InvalidInviteError();
  }
  return { hosts: h as string[], port: p, secret: s, fingerprint: f };
}

function toBase64Url(ascii: string): string {
  let out = '';
  for (let i = 0; i < ascii.length; i += 3) {
    const a = asciiCode(ascii, i);
    const b = i + 1 < ascii.length ? asciiCode(ascii, i + 1) : 0;
    const c = i + 2 < ascii.length ? asciiCode(ascii, i + 2) : 0;
    const n = (a << 16) | (b << 8) | c;
    out += BASE64URL[(n >> 18) & 63]! + BASE64URL[(n >> 12) & 63]!;
    if (i + 1 < ascii.length) out += BASE64URL[(n >> 6) & 63]!;
    if (i + 2 < ascii.length) out += BASE64URL[n & 63]!;
  }
  return out;
}

function fromBase64Url(text: string): string {
  if (text.length % 4 === 1) {
    throw new InvalidInviteError();
  }
  let out = '';
  for (let i = 0; i < text.length; i += 4) {
    const chunk = text.slice(i, i + 4);
    let n = 0;
    for (let j = 0; j < 4; j++) {
      const value = j < chunk.length ? BASE64URL.indexOf(chunk[j]!) : 0;
      if (value < 0) {
        throw new InvalidInviteError();
      }
      n = (n << 6) | value;
    }
    out += String.fromCharCode((n >> 16) & 255);
    if (chunk.length > 2) out += String.fromCharCode((n >> 8) & 255);
    if (chunk.length > 3) out += String.fromCharCode(n & 255);
  }
  return out;
}

function asciiCode(text: string, index: number): number {
  const code = text.charCodeAt(index);
  if (code > 127) {
    throw new Error('Invite codes can only contain ASCII characters.');
  }
  return code;
}
