import { HostGameLog, TableHost } from '@commander-brawl/application';
import type { Player } from '@commander-brawl/domain';
import { createServer, type Server } from 'node:https';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  TABLE_PATH,
  TABLE_PROTOCOL_VERSION,
  TableCloseCode,
  parseClientMessage,
  type TableServerMessage,
} from '../protocol';
import type { TlsIdentity } from './certificate';
import { closeServer, listenWithFallback, nodeTimers, randomId, secureRandom } from './runtime';

export interface TableServerOptions {
  readonly identity: TlsIdentity;
  readonly secret: string;
  readonly preferredPort: number;
  readonly reconnectGraceMs?: number;
  readonly heartbeatMs?: number;
  readonly helloTimeoutMs?: number;
}

/**
 * Runs on the hosting player's computer. Players connect here to take a seat and to exchange
 * connection details with each other. Video does not pass through here; it flows directly between players.
 */
export class TableServer {
  private readonly connections = new Map<string, WebSocket>();
  private readonly alive = new WeakSet<WebSocket>();

  private constructor(
    private readonly server: Server,
    private readonly sockets: WebSocketServer,
    private readonly host: TableHost,
    private readonly game: HostGameLog,
    readonly port: number,
    private readonly heartbeat: NodeJS.Timeout,
    private readonly helloTimeoutMs: number,
  ) {
    host.addListener({
      memberJoined: (member) => this.broadcast({ t: 'member-joined', member }, member.id),
      memberLeft: (member) => this.broadcast({ t: 'member-left', memberId: member.id }, member.id),
    });
    sockets.on('connection', (ws) => this.accept(ws));
  }

  static async start(options: TableServerOptions): Promise<TableServer> {
    const server = createServer({ key: options.identity.key, cert: options.identity.cert }, (_request, response) => {
      response.writeHead(404).end();
    });
    const sockets = new WebSocketServer({ server, path: TABLE_PATH, maxPayload: 64 * 1024 });
    const host = new TableHost({
      secret: options.secret,
      reconnectGraceMs: options.reconnectGraceMs ?? 30_000,
      timers: nodeTimers,
      createId: randomId,
    });
    const game = new HostGameLog(randomId(), Date.now, secureRandom);
    const port = await listenWithFallback(server, options.preferredPort);
    const heartbeat = setInterval(() => table.checkHeartbeat(), options.heartbeatMs ?? 10_000);
    const table = new TableServer(server, sockets, host, game, port, heartbeat, options.helloTimeoutMs ?? 10_000);
    return table;
  }

  get members(): readonly Player[] {
    return this.host.members;
  }

  async close(): Promise<void> {
    clearInterval(this.heartbeat);
    for (const client of this.sockets.clients) client.close(TableCloseCode.tableClosed, 'The host closed the table');
    // Give the goodbyes a moment to go out before cutting the connections.
    await new Promise((resolve) => setTimeout(resolve, 100));
    for (const client of this.sockets.clients) client.terminate();
    this.sockets.close();
    this.server.closeAllConnections();
    await closeServer(this.server);
  }

  private accept(ws: WebSocket): void {
    let memberId: string | null = null;
    this.alive.add(ws);
    const helloTimer = setTimeout(() => ws.close(TableCloseCode.helloTimeout, 'No hello'), this.helloTimeoutMs);

    ws.on('pong', () => this.alive.add(ws));
    ws.on('message', (data) => {
      this.alive.add(ws);
      const message = parseClientMessage(data.toString());
      if (!message) return;

      if (memberId === null) {
        if (message.t !== 'hello') return;
        clearTimeout(helloTimer);
        if (message.v !== TABLE_PROTOCOL_VERSION) {
          this.reject(ws, 'bad-version');
          return;
        }
        const result = this.host.join({ secret: message.secret, name: message.name, resumeToken: message.resumeToken });
        if (!result.ok) {
          this.reject(ws, result.reason);
          return;
        }
        memberId = result.member.id;
        // A player who reconnects before we noticed the old connection died replaces it.
        this.connections.get(memberId)?.close(TableCloseCode.replaced, 'Replaced by a new connection');
        this.connections.set(memberId, ws);
        send(ws, { t: 'welcome', selfId: memberId, resumeToken: result.resumeToken, members: result.members });
        return;
      }

      switch (message.t) {
        case 'signal': {
          const target = this.connections.get(message.to);
          if (target) send(target, { t: 'signal', from: memberId, data: message.data });
          break;
        }
        case 'event': {
          const author = this.host.members.find((m) => m.id === memberId);
          if (!author) break;
          const result = this.game.append(author, message.id, message.event);
          if (result.ok) {
            // Everyone gets it, the author too: that's their confirmation.
            const { entry } = result;
            this.broadcastAll({ t: 'events', logId: this.game.logId, from: entry.seq, events: [entry] });
          } else if (result.reason === 'refused') {
            send(ws, { t: 'refused', id: message.id });
          }
          break;
        }
        case 'sync': {
          const batch = this.game.batchFor(message.logId, message.from);
          send(ws, { t: 'events', ...batch });
          break;
        }
        case 'bye':
          this.connections.delete(memberId);
          this.host.leave(memberId);
          ws.close(1000, 'Bye');
          break;
        case 'hello':
          break;
      }
    });
    ws.on('close', () => {
      clearTimeout(helloTimer);
      if (memberId !== null && this.connections.get(memberId) === ws) {
        this.connections.delete(memberId);
        this.host.connectionLost(memberId);
      }
    });
  }

  private reject(ws: WebSocket, reason: Extract<TableServerMessage, { t: 'rejected' }>['reason']): void {
    send(ws, { t: 'rejected', reason });
    ws.close(TableCloseCode.rejected, reason);
  }

  private broadcast(message: TableServerMessage, exceptMemberId: string): void {
    for (const [memberId, ws] of this.connections) {
      if (memberId !== exceptMemberId) send(ws, message);
    }
  }

  private broadcastAll(message: TableServerMessage): void {
    const data = JSON.stringify(message);
    for (const ws of this.connections.values()) {
      if (ws.readyState === ws.OPEN) ws.send(data);
    }
  }

  private checkHeartbeat(): void {
    for (const client of this.sockets.clients) {
      if (!this.alive.has(client)) {
        client.terminate();
        continue;
      }
      this.alive.delete(client);
      client.ping();
    }
  }
}

function send(ws: WebSocket, message: TableServerMessage): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
}
