import {
  bindingRequest,
  createIdentity,
  parseBindingResponse,
  publicIpv4,
  reachesServer,
} from '@commander-brawl/infrastructure/node';
import { randomBytes } from 'node:crypto';
import { createSocket, type Socket } from 'node:dgram';
import type { AddressInfo } from 'node:net';
import { createServer } from 'node:tls';
import { afterEach, describe, expect, it } from 'vitest';

const MAGIC_COOKIE = 0x2112a442;

/** A STUN server's answer: the address it sees, XORed with the magic cookie as the standard has it. */
function answer(request: Buffer, address: string, port: number): Buffer {
  const message = Buffer.alloc(32);
  message.writeUInt16BE(0x0101, 0);
  message.writeUInt16BE(12, 2);
  message.writeUInt32BE(MAGIC_COOKIE, 4);
  request.copy(message, 8, 8, 20);
  message.writeUInt16BE(0x0020, 20);
  message.writeUInt16BE(8, 22);
  message.writeUInt8(0x01, 25);
  message.writeUInt16BE(port ^ (MAGIC_COOKIE >>> 16), 26);
  address
    .split('.')
    .forEach((octet, i) => message.writeUInt8(Number(octet) ^ ((MAGIC_COOKIE >>> (24 - 8 * i)) & 0xff), 28 + i));
  return message;
}

const closing: (() => void)[] = [];
afterEach(() => {
  for (const close of closing.splice(0)) close();
});

/** A STUN server on this computer that says it sees everyone at `address`. */
async function fakeStunServer(address: string): Promise<number> {
  const socket: Socket = createSocket('udp4');
  socket.on('message', (request, from) => socket.send(answer(request, address, 40000), from.port, from.address));
  await new Promise<void>((resolve) => socket.bind(0, '127.0.0.1', resolve));
  closing.push(() => socket.close());
  return socket.address().port;
}

describe("finding this computer's public address", () => {
  it('reads the address out of a STUN answer, and only the answer to its own question', () => {
    const transaction = randomBytes(12);
    const request = bindingRequest(transaction);
    expect(parseBindingResponse(answer(request, '203.0.113.7', 51000), transaction)).toBe('203.0.113.7');
    expect(parseBindingResponse(answer(request, '203.0.113.7', 51000), randomBytes(12))).toBeNull();
    expect(parseBindingResponse(Buffer.from('not stun at all, really not'), transaction)).toBeNull();
  });

  it('asks STUN servers, and gives up when none answers', async () => {
    const port = await fakeStunServer('198.51.100.20');
    expect(await publicIpv4({ servers: [['127.0.0.1', port]] })).toBe('198.51.100.20');
    // A server that isn't there, and one whose name doesn't exist: no answer.
    const silent = await new Promise<number>((resolve) => {
      const socket = createSocket('udp4');
      socket.bind(0, '127.0.0.1', () => {
        const free = socket.address().port;
        socket.close(() => resolve(free));
      });
    });
    expect(
      await publicIpv4({
        servers: [
          ['127.0.0.1', silent],
          ['stun.invalid', 3478],
        ],
        timeoutMs: 300,
      }),
    ).toBeNull();
  });
});

describe('checking that a port forwarded by hand reaches the table', () => {
  it('reaches its own server, not just anything that answers', async () => {
    const identity = await createIdentity(['127.0.0.1']);
    const server = createServer({ key: identity.key, cert: identity.cert }, (socket) => socket.end());
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    closing.push(() => server.close());
    const { port } = server.address() as AddressInfo;

    expect(await reachesServer('127.0.0.1', port, identity.fingerprint)).toBe(true);
    // Some other server (a router answering on the port itself) isn't the table.
    const other = await createIdentity(['127.0.0.1']);
    expect(await reachesServer('127.0.0.1', port, other.fingerprint)).toBe(false);
    server.close();
    expect(await reachesServer('127.0.0.1', port, identity.fingerprint, 500)).toBe(false);
  });
});
