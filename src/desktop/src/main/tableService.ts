import {
  decodeInvite,
  encodeInvite,
  type GameSync,
  type GameView,
  type Invite,
  type SignalingEvent,
} from '@commander-brawl/application';
import { normalizePlayerName, toGameAction } from '@commander-brawl/domain';
import {
  globalIpv6Addresses,
  lanAddresses,
  openRouterPort,
  randomId,
  syncGame,
  TableClient,
  TableServer,
  type PortMappingResult,
  type TlsIdentity,
} from '@commander-brawl/infrastructure/node';
import type { HostInfo, Reachability } from '../shared/api';

export interface TableServiceOptions {
  readonly identity: TlsIdentity;
  readonly preferredPort: number;
  /** Set to false to skip asking the router to open a port (tests, or when it's forwarded manually). */
  readonly useUpnp: boolean;
  readonly emit: (event: SignalingEvent) => void;
  readonly emitGame: (view: GameView) => void;
}

/** Hosting or joining a table. The host is a player too: it connects to its own table like everyone else. */
export class TableService {
  private server: TableServer | null = null;
  private client: TableClient | null = null;
  private game: GameSync | null = null;
  private releasePort: (() => Promise<void>) | null = null;

  constructor(private readonly options: TableServiceOptions) {}

  async host(name: string): Promise<HostInfo> {
    const playerName = normalizePlayerName(name);
    await this.leave();
    const secret = randomId();
    const server = await TableServer.start({
      identity: this.options.identity,
      secret,
      preferredPort: this.options.preferredPort,
    });
    this.server = server;

    const lan = lanAddresses();
    const mapping: PortMappingResult =
      this.options.useUpnp && lan[0]
        ? await openRouterPort(server.port, lan[0])
        : { ok: false, reason: this.options.useUpnp ? 'Not connected to a network.' : 'Router port opening is off.' };
    if (mapping.ok) this.releasePort = () => mapping.release();

    const hosts = [
      ...(mapping.ok && mapping.reachable ? [mapping.externalIp] : []),
      ...globalIpv6Addresses().slice(0, 2),
      ...lan.slice(0, 3),
    ];
    const fingerprint = this.options.identity.fingerprint;
    const invite = encodeInvite({
      hosts: hosts.length > 0 ? hosts : ['127.0.0.1'],
      port: server.port,
      secret,
      fingerprint,
    });
    this.connect({ hosts: ['127.0.0.1'], port: server.port, secret, fingerprint }, playerName);
    return { invite, reachability: describeReachability(mapping, server.port) };
  }

  async join(inviteCode: string, name: string): Promise<void> {
    const playerName = normalizePlayerName(name);
    const invite = decodeInvite(inviteCode);
    await this.leave();
    this.connect(invite, playerName);
  }

  async leave(): Promise<void> {
    this.client?.close();
    this.client = null;
    this.game = null;
    const releasePort = this.releasePort;
    this.releasePort = null;
    const server = this.server;
    this.server = null;
    await Promise.all([releasePort?.().catch(() => undefined), server?.close()]);
  }

  send(to: string, data: unknown): void {
    this.client?.send(to, data);
  }

  snapshot(): SignalingEvent[] {
    return this.client?.snapshot() ?? [];
  }

  gameView(): GameView | null {
    return this.game?.getView() ?? null;
  }

  /** A change from the UI. It comes from the renderer, so check it like anything else from outside. */
  submitGameEvent(raw: unknown): void {
    const action = toGameAction(raw);
    if (action) this.game?.submit(action);
  }

  private connect(invite: Invite, name: string): void {
    const client = new TableClient({ invite, name });
    const game = syncGame(client);
    this.client = client;
    this.game = game;
    client.subscribe((event) => {
      if (this.client === client) this.options.emit(event);
    });
    game.subscribe((view) => {
      if (this.game === game) this.options.emitGame(view);
    });
    client.start();
  }
}

function describeReachability(mapping: PortMappingResult, port: number): Reachability {
  if (mapping.ok && mapping.reachable) {
    return { kind: 'internet', address: mapping.externalIp, port };
  }
  if (mapping.ok) {
    return {
      kind: 'blocked',
      port,
      reason: `Your router's internet address (${mapping.externalIp}) is shared by your internet provider, so friends outside your home can't reach it. Someone else should host.`,
    };
  }
  return { kind: 'blocked', port, reason: mapping.reason };
}
