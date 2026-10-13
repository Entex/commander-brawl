import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  PHONE_LINK_PATH,
  PHONE_REPLACED_CLOSE_CODE,
  parsePhoneToDesktop,
  type DesktopToPhone,
  type PhoneToDesktop,
} from '../protocol';
import type { TlsIdentity } from './certificate';
import { closeServer, listenWithFallback, safeEquals } from './runtime';

export interface PhoneLinkServerOptions {
  readonly identity: TlsIdentity;
  /** Folder with the built phone camera page. */
  readonly staticDir: string;
  /** Secret part of the QR code link. Only phones that know it can stream to this computer. */
  readonly token: string;
  readonly preferredPort: number;
  readonly heartbeatMs?: number;
}

export interface PhoneLinkEvents {
  connected(): void;
  disconnected(): void;
  message(message: PhoneToDesktop): void;
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

/**
 * Serves the phone camera page over the local network and relays the phone's video connection
 * setup to the desktop app. Only one phone is linked at a time; a new one replaces the old.
 */
export class PhoneLinkServer {
  private phone: WebSocket | null = null;

  private constructor(
    private readonly server: Server,
    private readonly sockets: WebSocketServer,
    readonly port: number,
    private readonly token: string,
    private readonly heartbeat: NodeJS.Timeout,
  ) {}

  static async start(options: PhoneLinkServerOptions, events: PhoneLinkEvents): Promise<PhoneLinkServer> {
    const server = createServer({ key: options.identity.key, cert: options.identity.cert }, (request, response) => {
      void serveStatic(options.staticDir, request, response);
    });
    const sockets = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
    const port = await listenWithFallback(server, options.preferredPort);
    const heartbeat = setInterval(() => link.checkHeartbeat(), options.heartbeatMs ?? 5_000);
    const link = new PhoneLinkServer(server, sockets, port, options.token, heartbeat);

    server.on('upgrade', (request, socket, head) => {
      if (!link.isAuthorized(request)) {
        socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        return;
      }
      sockets.handleUpgrade(request, socket, head, (ws) => link.accept(ws, events));
    });
    return link;
  }

  get isConnected(): boolean {
    return this.phone !== null;
  }

  /** Links to put in the QR code, one per local network address. */
  urls(addresses: readonly string[]): string[] {
    return addresses.map((address) => `https://${address}:${this.port}/#${this.token}`);
  }

  send(message: DesktopToPhone): boolean {
    if (!this.phone || this.phone.readyState !== this.phone.OPEN) return false;
    this.phone.send(JSON.stringify(message));
    return true;
  }

  async close(): Promise<void> {
    clearInterval(this.heartbeat);
    for (const client of this.sockets.clients) client.terminate();
    this.sockets.close();
    this.server.closeAllConnections();
    await closeServer(this.server);
  }

  private isAuthorized(request: IncomingMessage): boolean {
    const url = new URL(request.url ?? '/', 'https://phone.invalid');
    return url.pathname === PHONE_LINK_PATH && safeEquals(url.searchParams.get('token') ?? '', this.token);
  }

  private accept(ws: WebSocket, events: PhoneLinkEvents): void {
    const previous = this.phone;
    this.phone = ws;
    alive.add(ws);
    if (previous) {
      previous.close(PHONE_REPLACED_CLOSE_CODE, 'Another phone took over');
    } else {
      events.connected();
    }

    ws.on('pong', () => alive.add(ws));
    ws.on('message', (data) => {
      alive.add(ws);
      const message = parsePhoneToDesktop(data.toString());
      if (!message || this.phone !== ws) return;
      if (message.t === 'ping') {
        this.send({ t: 'pong' });
        return;
      }
      events.message(message);
    });
    ws.on('close', () => {
      alive.delete(ws);
      if (this.phone === ws) {
        this.phone = null;
        events.disconnected();
      }
    });
  }

  private checkHeartbeat(): void {
    for (const client of this.sockets.clients) {
      if (!alive.has(client)) {
        client.terminate();
        continue;
      }
      alive.delete(client);
      client.ping();
    }
  }
}

const alive = new WeakSet<WebSocket>();

async function serveStatic(root: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405).end();
    return;
  }
  try {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'https://phone.invalid').pathname);
    const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
    const filePath = normalize(join(root, relative));
    if (!filePath.startsWith(normalize(root + sep))) {
      response.writeHead(404).end();
      return;
    }
    const body = await readFile(filePath);
    response.writeHead(200, {
      'Content-Type': CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'camera=(self), microphone=()',
      'Content-Security-Policy':
        "default-src 'self'; connect-src 'self' wss:; img-src 'self' data:; media-src 'self' blob: mediastream:",
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch {
    response.writeHead(404).end();
  }
}
