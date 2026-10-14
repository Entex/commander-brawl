import type {
  GameSyncMessage,
  Invite,
  LogBatch,
  SignalingConnectionState,
  SignalingEvent,
  TableSignaling,
  Unsubscribe,
} from '@commander-brawl/application';
import type { Player, Spectator } from '@commander-brawl/domain';
import type { IncomingMessage } from 'node:http';
import type { TLSSocket } from 'node:tls';
import { WebSocket } from 'ws';
import {
  TABLE_PATH,
  TABLE_PROTOCOL_VERSION,
  TableCloseCode,
  parseServerMessage,
  type TableClientMessage,
  type TableRejection,
} from '../protocol';
import { normalizeFingerprint } from './certificate';

export interface TableClientOptions {
  readonly invite: Invite;
  readonly name: string;
  /** Reclaims a seat from before, e.g. the host's own seat after its app restarted. */
  readonly resumeToken?: string | undefined;
  /** Watch instead of taking a seat. */
  readonly spectator?: boolean;
  /** Give up on one address after this long and rely on the others. */
  readonly connectTimeoutMs?: number;
  /** Treat the connection as dead if the host has been silent this long. */
  readonly silenceTimeoutMs?: number;
}

export type GameUpdate =
  { readonly type: 'batch'; readonly batch: LogBatch } | { readonly type: 'refused'; readonly id: string };

const RECONNECT_DELAYS_MS = [250, 1_000, 2_000, 4_000, 5_000];

const REJECTION_MESSAGES: Record<TableRejection, string> = {
  'bad-secret': 'The invite is wrong or out of date.',
  'table-full': 'The table is full.',
  'bad-name': 'Pick a name between 1 and 24 characters.',
  'bad-version': 'You and the host are on different versions of the app. Both of you should update.',
  'too-many-spectators': 'Too many people are watching this table already.',
};

/**
 * Keeps a connection to the table host and reconnects on its own when it drops.
 * While it's reconnecting, video between players keeps flowing; only seat changes wait.
 */
export class TableClient implements TableSignaling {
  private readonly listeners = new Set<(event: SignalingEvent) => void>();
  private readonly gameListeners = new Set<(update: GameUpdate) => void>();
  private readonly members = new Map<string, Player>();
  private readonly spectators = new Map<string, Spectator>();
  private socket: WebSocket | null = null;
  private selfId: string | null = null;
  private resumeToken: string | undefined;
  private connection: SignalingConnectionState = 'connecting';
  private connectionReason: string | undefined;
  private attempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private silenceTimer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(private readonly options: TableClientOptions) {
    this.resumeToken = options.resumeToken;
  }

  /** Lets the host give this player the same seat back after a dropped connection. */
  get currentResumeToken(): string | undefined {
    return this.resumeToken;
  }

  start(): void {
    void this.connect();
  }

  subscribe(listener: (event: SignalingEvent) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Events that bring a late subscriber up to date. */
  snapshot(): SignalingEvent[] {
    const events: SignalingEvent[] = [{ type: 'connection', state: this.connection, ...this.reasonField() }];
    if (this.selfId !== null) {
      events.push({
        type: 'welcome',
        selfId: this.selfId,
        members: [...this.members.values()],
        spectators: [...this.spectators.values()],
      });
    }
    return events;
  }

  send(to: string, data: unknown): void {
    this.write({ t: 'signal', to, data });
  }

  /** Game log entries from the host, and actions of ours it turned down. */
  subscribeGame(listener: (update: GameUpdate) => void): Unsubscribe {
    this.gameListeners.add(listener);
    return () => this.gameListeners.delete(listener);
  }

  /** Sends a game message to the host. Returns false until we're seated, or while reconnecting. */
  sendGame(message: GameSyncMessage): boolean {
    if (this.connection !== 'connected') return false;
    return message.kind === 'event'
      ? this.write({ t: 'event', id: message.id, event: message.event })
      : this.write({ t: 'sync', logId: message.logId, from: message.from });
  }

  /** Leaves the table on purpose: the seat is given up at once. */
  close(): void {
    if (this.stopped) return;
    this.write({ t: 'bye' });
    this.stop('closed', undefined);
  }

  /** Drops the connection without leaving, e.g. when the app quits. The seat is kept for a while. */
  disconnect(): void {
    if (this.stopped) return;
    this.stop('closed', undefined);
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    let ws: WebSocket;
    try {
      ws = await this.openFirst();
    } catch (error) {
      this.scheduleReconnect((error as Error).message);
      return;
    }
    if (this.stopped) {
      ws.terminate();
      return;
    }
    this.socket = ws;
    this.resetSilenceTimer();
    ws.on('ping', () => this.resetSilenceTimer());
    ws.on('message', (data) => {
      this.resetSilenceTimer();
      this.handleMessage(data.toString());
    });
    ws.on('close', (code, reason) => this.handleClose(ws, code, reason.toString()));
    ws.on('error', () => undefined);
    this.write({
      t: 'hello',
      v: TABLE_PROTOCOL_VERSION,
      secret: this.options.invite.secret,
      name: this.options.name,
      resumeToken: this.resumeToken,
      ...(this.options.spectator ? { spectator: true } : {}),
    });
  }

  /** Tries every address in the invite at once and keeps the first that answers as the real host. */
  private openFirst(): Promise<WebSocket> {
    const { hosts, port, fingerprint } = this.options.invite;
    const timeoutMs = this.options.connectTimeoutMs ?? 6_000;
    return new Promise((resolve, reject) => {
      if (hosts.length === 0) {
        reject(new Error('The invite has no host address.'));
        return;
      }
      const pending = new Set<WebSocket>();
      let settled = false;
      let lastError = 'Could not reach the host.';
      const finish = () => {
        if (!settled && pending.size === 0) {
          settled = true;
          reject(new Error(lastError));
        }
      };
      hosts.forEach((host, index) => {
        setTimeout(() => {
          if (settled) return;
          const ws = new WebSocket(`wss://${formatHost(host)}:${port}${TABLE_PATH}`, {
            rejectUnauthorized: false,
            handshakeTimeout: timeoutMs,
          });
          pending.add(ws);
          ws.on('upgrade', (response: IncomingMessage) => {
            const certificate = (response.socket as TLSSocket).getPeerCertificate();
            if (!certificate.fingerprint256 || normalizeFingerprint(certificate.fingerprint256) !== fingerprint) {
              lastError = 'Reached a computer that is not the host. Check the invite.';
              ws.terminate();
            }
          });
          ws.once('open', () => {
            pending.delete(ws);
            if (settled) {
              ws.terminate();
              return;
            }
            settled = true;
            for (const other of pending) other.terminate();
            ws.removeAllListeners();
            resolve(ws);
          });
          ws.on('error', () => undefined);
          ws.once('close', () => {
            pending.delete(ws);
            finish();
          });
        }, index * 150);
      });
    });
  }

  private handleMessage(raw: string): void {
    const message = parseServerMessage(raw);
    if (!message) return;
    switch (message.t) {
      case 'welcome':
        this.attempt = 0;
        this.selfId = message.selfId;
        this.resumeToken = message.resumeToken;
        this.members.clear();
        for (const member of message.members) this.members.set(member.id, member);
        this.spectators.clear();
        for (const spectator of message.spectators ?? []) this.spectators.set(spectator.id, spectator);
        this.setConnection('connected', undefined);
        this.emit({
          type: 'welcome',
          selfId: message.selfId,
          members: message.members,
          spectators: message.spectators ?? [],
        });
        break;
      case 'member-joined':
        this.members.set(message.member.id, message.member);
        this.emit({ type: 'member-joined', member: message.member });
        break;
      case 'spectator-joined':
        this.spectators.set(message.spectator.id, message.spectator);
        this.emit({ type: 'spectator-joined', spectator: message.spectator });
        break;
      case 'member-left':
        this.members.delete(message.memberId);
        this.spectators.delete(message.memberId);
        this.emit({ type: 'member-left', memberId: message.memberId });
        break;
      case 'signal':
        this.emit({ type: 'signal', from: message.from, data: message.data });
        break;
      case 'events': {
        const batch: LogBatch = {
          logId: message.logId,
          from: message.from,
          events: message.events,
          ...(message.live ? { live: true } : {}),
        };
        for (const listener of this.gameListeners) listener({ type: 'batch', batch });
        break;
      }
      case 'refused':
        for (const listener of this.gameListeners) listener({ type: 'refused', id: message.id });
        break;
      case 'rejected':
        this.stop('closed', REJECTION_MESSAGES[message.reason]);
        break;
    }
  }

  private handleClose(ws: WebSocket, code: number, reason: string): void {
    if (this.socket !== ws) return;
    this.socket = null;
    this.clearSilenceTimer();
    if (this.stopped) return;
    if (code === TableCloseCode.rejected) {
      this.stop('closed', reason || 'The host turned us away.');
      return;
    }
    if (code === TableCloseCode.tableClosed) {
      this.stop('closed', 'The host closed the table.');
      return;
    }
    this.scheduleReconnect('Lost the connection to the host.');
  }

  private scheduleReconnect(reason: string): void {
    if (this.stopped) return;
    this.setConnection(this.selfId === null ? 'connecting' : 'reconnecting', reason);
    const delay = RECONNECT_DELAYS_MS[Math.min(this.attempt, RECONNECT_DELAYS_MS.length - 1)]!;
    this.attempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  private resetSilenceTimer(): void {
    this.clearSilenceTimer();
    this.silenceTimer = setTimeout(() => this.socket?.terminate(), this.options.silenceTimeoutMs ?? 25_000);
  }

  private clearSilenceTimer(): void {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = null;
  }

  private stop(state: SignalingConnectionState, reason: string | undefined): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.clearSilenceTimer();
    this.socket?.close(1000);
    this.socket = null;
    this.setConnection(state, reason);
  }

  private write(message: TableClientMessage): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  private setConnection(state: SignalingConnectionState, reason: string | undefined): void {
    this.connection = state;
    this.connectionReason = reason;
    this.emit({ type: 'connection', state, ...this.reasonField() });
  }

  private reasonField(): { reason?: string } {
    return this.connectionReason === undefined ? {} : { reason: this.connectionReason };
  }

  private emit(event: SignalingEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

function formatHost(host: string): string {
  return host.includes(':') ? `[${host}]` : host;
}
