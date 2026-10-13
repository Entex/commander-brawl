import { createSocket } from 'node:dgram';

/**
 * NAT-PMP (RFC 6886): Apple's way of asking a home router to forward a port, which many routers answer besides UPnP.
 * It's a plain question to the router's own address, so it gets through where UPnP's search of the network doesn't.
 * The router forwards the port to whichever computer asks.
 */

const NAT_PMP_PORT = 5351;
/** Asked again after 250 ms, then twice as long each time, as the standard says. */
const FIRST_WAIT_MS = 250;

export interface NatPmpRouter {
  readonly address: string;
  /** The router's NAT-PMP port; a test's own responder can be elsewhere. */
  readonly port?: number;
  /** This computer's address to ask from, which is where the router forwards the port. */
  readonly from: string;
}

export class NatPmpError extends Error {
  constructor(
    message: string,
    /** The router's result code, or the system's error code (like EHOSTUNREACH) if the question couldn't be sent. */
    readonly code: number | string | null = null,
  ) {
    super(message);
    this.name = 'NatPmpError';
  }
}

const RESULTS: Readonly<Record<number, string>> = {
  1: "it doesn't speak this version of NAT-PMP",
  2: "it isn't allowed to (NAT-PMP may be turned off)",
  3: "it isn't connected to the internet",
  4: 'it has no room for another forwarded port',
  5: "it doesn't do that",
};

/** The router's address on the internet. */
export async function natPmpExternalAddress(router: NatPmpRouter, timeoutMs = 2_000): Promise<string> {
  const answer = await ask(router, Buffer.from([0, 0]), 12, timeoutMs);
  return [...answer.subarray(8, 12)].join('.');
}

export interface NatPmpMapping {
  /** The port opened on the internet side. The router may pick another one if this computer's is taken. */
  readonly externalPort: number;
  /** How long the router keeps it, in seconds, unless asked again. */
  readonly leaseSeconds: number;
}

/** Forwards a TCP port on the router to this computer, for a while. A lease of 0 removes the forward. */
export async function natPmpMapTcp(
  router: NatPmpRouter,
  port: number,
  leaseSeconds: number,
  timeoutMs = 2_000,
): Promise<NatPmpMapping> {
  const request = Buffer.alloc(12);
  request[1] = 2; // TCP
  request.writeUInt16BE(port, 4);
  request.writeUInt16BE(leaseSeconds === 0 ? 0 : port, 6);
  request.writeUInt32BE(leaseSeconds, 8);
  const answer = await ask(router, request, 16, timeoutMs);
  return { externalPort: answer.readUInt16BE(10), leaseSeconds: answer.readUInt32BE(12) };
}

/** Sends the question until the router answers, refuses, or time's up. */
function ask(router: NatPmpRouter, request: Buffer, answerLength: number, timeoutMs: number): Promise<Buffer> {
  const opcode = request[1]!;
  return new Promise((resolve, reject) => {
    const socket = createSocket('udp4');
    let wait = FIRST_WAIT_MS;
    let resend: NodeJS.Timeout | undefined;
    let settled = false;
    const finish = (error: Error | null, answer?: Buffer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(resend);
      socket.close();
      if (error) reject(error);
      else resolve(answer!);
    };
    const timer = setTimeout(() => finish(new NatPmpError("The router didn't answer NAT-PMP.")), timeoutMs);
    socket.on('message', (message, sender) => {
      if (sender.address !== router.address || message.length < 4) return;
      if (message[0] !== 0 || message[1] !== opcode + 128) return;
      const result = message.readUInt16BE(2);
      if (result !== 0) {
        finish(new NatPmpError(`The router refused: ${RESULTS[result] ?? `error ${result}`}.`, result));
      } else if (message.length < answerLength) {
        finish(new NatPmpError("The router's answer was cut short."));
      } else {
        finish(null, message);
      }
    });
    socket.on('error', (error) => finish(error));
    const send = () => {
      if (settled) return;
      socket.send(request, router.port ?? NAT_PMP_PORT, router.address, (error) => {
        const code = (error as NodeJS.ErrnoException | null)?.code;
        if (error) finish(new NatPmpError(`The question to the router couldn't be sent (${code}).`, code ?? null));
      });
      resend = setTimeout(send, wait);
      wait *= 2;
    };
    socket.bind(0, router.from, send);
  });
}
