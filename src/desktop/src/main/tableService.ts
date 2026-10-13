import {
  decodeInvite,
  encodeInvite,
  gamesInLog,
  type GameRecord,
  type GameSync,
  type GameView,
  type Invite,
  type LoggedEvent,
  type SignalingEvent,
} from '@commander-brawl/application';
import { normalizePlayerName, toGameAction, type SeatIndex } from '@commander-brawl/domain';
import {
  FileTableStore,
  globalIpv6Addresses,
  lanAddresses,
  openRouterPort,
  randomId,
  syncGame,
  TableClient,
  TableServer,
  type PortMappingResult,
  type SavedTable,
  type TlsIdentity,
} from '@commander-brawl/infrastructure/node';
import type { HostInfo, Reachability, SavedTableSummary } from '../shared/api';

export interface TableServiceOptions {
  readonly identity: TlsIdentity;
  readonly preferredPort: number;
  /** Set to false to skip asking the router to open a port (tests, or when it's forwarded manually). */
  readonly useUpnp: boolean;
  /** Folder for the table you host, so it can be resumed if the app restarts. */
  readonly tableDir: string;
  readonly emit: (event: SignalingEvent) => void;
  readonly emitGame: (view: GameView) => void;
  /** Finished games, as they finish (or when the table closes with one decided). */
  readonly gamesFinished: (games: readonly GameRecord[]) => void;
}

interface HostingPlan {
  readonly secret: string;
  readonly preferredPort: number;
  readonly playerName: string;
  /** Only when resuming: the table as it was saved. */
  readonly saved?: SavedTable;
}

/** Hosting or joining a table. The host is a player too: it connects to its own table like everyone else. */
export class TableService {
  private server: TableServer | null = null;
  private client: TableClient | null = null;
  private game: GameSync | null = null;
  private store: FileTableStore | null = null;
  private releasePort: (() => Promise<void>) | null = null;
  /** Joined to watch: changes from this app aren't sent. */
  private watching = false;
  /** Everyone who sat at the table, by seat, for the game history. */
  private readonly names = new Map<SeatIndex, string>();

  constructor(private readonly options: TableServiceOptions) {}

  async host(name: string): Promise<HostInfo> {
    const playerName = normalizePlayerName(name);
    await this.leave();
    return this.startHosting({ secret: randomId(), preferredPort: this.options.preferredPort, playerName });
  }

  /** The table this app was hosting before it closed, if there is one. */
  async savedTable(): Promise<SavedTableSummary | null> {
    const saved = await FileTableStore.load(this.options.tableDir);
    if (!saved) return null;
    return {
      savedAt: saved.savedAt,
      playerName: saved.playerName,
      players: saved.members.map((m) => m.player.name).filter((n) => n !== saved.playerName),
    };
  }

  /** Opens the saved table again. Friends' apps are still trying to reconnect, so they come straight back. */
  async resume(): Promise<HostInfo> {
    const saved = await FileTableStore.load(this.options.tableDir);
    if (!saved) throw new Error('There is no table to resume.');
    await this.stop({ notify: true, forget: false });
    return this.startHosting({
      secret: saved.secret,
      preferredPort: saved.port,
      playerName: saved.playerName,
      saved,
    });
  }

  async discardSavedTable(): Promise<void> {
    new FileTableStore(this.options.tableDir).clear();
  }

  /** Joins as a player, or (`watch`) as a spectator: no seat, and nothing you do changes the game. */
  async join(inviteCode: string, name: string, watch = false): Promise<void> {
    const playerName = normalizePlayerName(name);
    const invite = decodeInvite(inviteCode);
    await this.leave();
    this.connect(invite, playerName, undefined, watch);
  }

  /** Leaving on purpose. If you were hosting, the table is over for everyone. */
  async leave(): Promise<void> {
    await this.stop({ notify: true, forget: true });
  }

  /**
   * The app is quitting. A table you host isn't closed: friends keep trying to reconnect,
   * and you can resume it when you open the app again.
   */
  async shutdown(): Promise<void> {
    await this.stop({ notify: false, forget: false });
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

  gameLog(): readonly LoggedEvent[] {
    return this.game?.getLog() ?? [];
  }

  /** A change from the UI. It comes from the renderer, so check it like anything else from outside. */
  submitGameEvent(raw: unknown): void {
    if (this.watching) return;
    const action = toGameAction(raw);
    if (action) this.game?.submit(action);
  }

  private async startHosting(plan: HostingPlan): Promise<HostInfo> {
    const store = new FileTableStore(this.options.tableDir);
    const server = await TableServer.start({
      identity: this.options.identity,
      secret: plan.secret,
      preferredPort: plan.preferredPort,
      store,
      ...(plan.saved ? { restore: { members: plan.saved.members, entries: plan.saved.entries } } : {}),
    });
    this.server = server;
    this.store = store;
    const meta = {
      secret: plan.secret,
      port: server.port,
      playerName: plan.playerName,
      ownResumeToken: plan.saved?.ownResumeToken ?? null,
    };
    if (plan.saved) store.continue(plan.saved, meta);
    else store.begin(meta);

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
      secret: plan.secret,
      fingerprint,
    });
    this.connect(
      { hosts: ['127.0.0.1'], port: server.port, secret: plan.secret, fingerprint },
      plan.playerName,
      meta.ownResumeToken ?? undefined,
    );
    return {
      invite,
      reachability: describeReachability(mapping, server.port),
      portChanged: plan.saved !== undefined && server.port !== plan.saved.port,
    };
  }

  /** Records the table's finished games. Recording a game again just updates it. */
  private recordGames(): void {
    const game = this.game;
    const logId = game?.getLogId();
    if (!game || !logId) return;
    const games = gamesInLog(game.getLog(), logId, (seat) => this.names.get(seat) ?? null);
    if (games.length > 0) this.options.gamesFinished(games);
  }

  private async stop({ notify, forget }: { notify: boolean; forget: boolean }): Promise<void> {
    this.recordGames();
    this.names.clear();
    // Quitting the app isn't leaving: keep the seat, so resuming the table puts everyone back.
    if (notify) this.client?.close();
    else this.client?.disconnect();
    this.client = null;
    this.game = null;
    const releasePort = this.releasePort;
    this.releasePort = null;
    const server = this.server;
    this.server = null;
    const store = this.store;
    this.store = null;
    await Promise.all([releasePort?.().catch(() => undefined), server?.close({ notify })]);
    if (forget) store?.clear();
  }

  private connect(invite: Invite, name: string, resumeToken?: string, watch = false): void {
    this.watching = watch;
    const client = new TableClient({ invite, name, resumeToken, spectator: watch });
    const game = syncGame(client);
    const store = this.store;
    this.client = client;
    this.game = game;
    client.subscribe((event) => {
      if (this.client !== client) return;
      if (event.type === 'welcome') for (const member of event.members) this.names.set(member.seat, member.name);
      if (event.type === 'member-joined') this.names.set(event.member.seat, event.member.name);
      // Remember the host's own seat, so resuming the table puts them back in it.
      if (event.type === 'welcome' && store) store.updateMeta({ ownResumeToken: client.currentResumeToken ?? null });
      this.options.emit(event);
    });
    let games = 0;
    game.subscribe((view) => {
      if (this.game !== game) return;
      this.options.emitGame(view);
      // A new game means the one before it is over.
      if (view.state.number > games) {
        if (games > 0) this.recordGames();
        games = view.state.number;
      }
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
