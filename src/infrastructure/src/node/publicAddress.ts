import { randomBytes } from 'node:crypto';
import { createSocket } from 'node:dgram';
import { connect } from 'node:tls';
import { normalizeFingerprint } from './certificate';

/**
 * STUN servers, which tell a computer the address the internet sees it at. The same one the video links use:
 * Cloudflare's, which they offer free to anyone (Google's are widely used, but not offered for apps like this one).
 */
export const STUN_SERVERS: readonly (readonly [host: string, port: number])[] = [['stun.cloudflare.com', 3478]];

const BINDING_REQUEST = 0x0001;
const BINDING_SUCCESS = 0x0101;
const MAGIC_COOKIE = 0x2112a442;
const MAPPED_ADDRESS = 0x0001;
const XOR_MAPPED_ADDRESS = 0x0020;
const IPV4 = 0x01;

/**
 * This computer's public IPv4 address, as a STUN server out on the internet sees it: what friends outside the
 * home connect to, when the router forwards the port. Null if no server answers in time.
 */
export function publicIpv4(
  options: { servers?: readonly (readonly [string, number])[]; timeoutMs?: number } = {},
): Promise<string | null> {
  const { servers = STUN_SERVERS, timeoutMs = 3_000 } = options;
  return new Promise((resolve) => {
    const socket = createSocket('udp4');
    const transaction = randomBytes(12);
    let settled = false;
    const done = (address: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      resolve(address);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    socket.on('message', (message) => {
      const address = parseBindingResponse(message, transaction);
      if (address) done(address);
    });
    socket.on('error', () => done(null));
    const request = bindingRequest(transaction);
    // A server that can't be looked up or reached just doesn't answer; the others may.
    for (const [host, port] of servers) socket.send(request, port, host, () => undefined);
  });
}

/** A STUN binding request: "what address do you see me at?" */
export function bindingRequest(transaction: Buffer): Buffer {
  const message = Buffer.alloc(20);
  message.writeUInt16BE(BINDING_REQUEST, 0);
  message.writeUInt16BE(0, 2);
  message.writeUInt32BE(MAGIC_COOKIE, 4);
  transaction.copy(message, 8, 0, 12);
  return message;
}

/** The IPv4 address in a STUN server's answer to our request, or null if it isn't one. */
export function parseBindingResponse(message: Buffer, transaction: Buffer): string | null {
  if (message.length < 20 || message.readUInt16BE(0) !== BINDING_SUCCESS) return null;
  if (message.readUInt32BE(4) !== MAGIC_COOKIE || !message.subarray(8, 20).equals(transaction.subarray(0, 12))) {
    return null;
  }
  const end = Math.min(message.length, 20 + message.readUInt16BE(2));
  let plain: string | null = null;
  for (let offset = 20; offset + 4 <= end;) {
    const type = message.readUInt16BE(offset);
    const length = message.readUInt16BE(offset + 2);
    const value = message.subarray(offset + 4, offset + 4 + length);
    if (value.length >= 8 && value[1] === IPV4) {
      const octets = [...value.subarray(4, 8)];
      if (type === XOR_MAPPED_ADDRESS) {
        // XORed with the magic cookie, so routers that rewrite addresses in packets leave it alone.
        return octets.map((octet, i) => octet ^ ((MAGIC_COOKIE >>> (24 - 8 * i)) & 0xff)).join('.');
      }
      if (type === MAPPED_ADDRESS) plain = octets.join('.');
    }
    offset += 4 + Math.ceil(length / 4) * 4;
  }
  return plain;
}

/**
 * Whether a connection to the address and port reaches the server with this certificate (its fingerprint):
 * this computer's own table, through the router, the way a friend's would. Just getting a connection isn't
 * enough: some routers answer on a port themselves.
 */
export function reachesServer(host: string, port: number, fingerprint: string, timeoutMs = 3_000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port, rejectUnauthorized: false });
    const done = (reached: boolean) => {
      socket.destroy();
      resolve(reached);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('secureConnect', () => {
      const certificate = socket.getPeerCertificate();
      done(Boolean(certificate.fingerprint256) && normalizeFingerprint(certificate.fingerprint256) === fingerprint);
    });
    socket.once('error', () => done(false));
  });
}
