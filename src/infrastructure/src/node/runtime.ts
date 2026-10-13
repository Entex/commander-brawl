import type { Timers } from '@commander-brawl/application';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { AddressInfo, Server } from 'node:net';

export const nodeTimers: Timers = {
  setTimeout(callback, ms) {
    const handle = setTimeout(callback, ms);
    return () => clearTimeout(handle);
  },
  now: () => Date.now(),
};

/** 128 random bits, URL-safe. */
export function randomId(): string {
  return randomBytes(16).toString('base64url');
}

export function safeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Listens on the preferred port, or any free port if it's taken. */
export async function listenWithFallback(server: Server, preferredPort: number, host?: string): Promise<number> {
  try {
    await listen(server, preferredPort, host);
  } catch (error) {
    if (preferredPort === 0 || (error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
    await listen(server, 0, host);
  }
  return (server.address() as AddressInfo).port;
}

function listen(server: Server, port: number, host?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

export function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}
