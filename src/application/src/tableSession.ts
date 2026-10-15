import type { Player, Spectator } from '@commander-brawl/domain';
import type {
  LinkState,
  LinkStats,
  PeerLink,
  PeerLinkFactory,
  SignalingConnectionState,
  SignalingEvent,
  TableSignaling,
  Timers,
  Unsubscribe,
} from './ports';

/** What a player's camera is doing, as that player's own computer sees it. */
export type CameraStatus = 'live' | 'reconnecting' | 'off';

export interface SeatView<TTrack> {
  readonly player: Player;
  readonly isSelf: boolean;
  /** Your own camera for your seat, the other player's camera for theirs. */
  readonly track: TTrack | null;
  readonly link: LinkState | 'self';
  /** Null until that player has told us. */
  readonly camera: CameraStatus | null;
}

export interface TableSessionState<TTrack> {
  readonly connection: SignalingConnectionState;
  readonly connectionReason: string | null;
  readonly selfId: string | null;
  readonly seats: readonly SeatView<TTrack>[];
  /** People watching the table. */
  readonly spectators: readonly Spectator[];
  /** You're watching, not playing. */
  readonly spectating: boolean;
}

export interface TableSessionOptions {
  readonly timers: Timers;
  /**
   * If a link hasn't connected within this time, the initiator throws it away and starts a fresh one.
   * This is the safety net on top of the link's own reconnect logic.
   */
  readonly linkResetMs: number;
}

/** Sent to every other player when your camera status changes, and to players who join later. */
interface StatusMessage {
  readonly status: { readonly camera: CameraStatus };
}

/** Every signal is wrapped with the link generation, so messages meant for a replaced link are ignored. */
interface Envelope {
  readonly gen: number;
  readonly body: unknown;
}

interface LinkEntry<TTrack> {
  link: PeerLink<TTrack>;
  readonly generation: number;
  readonly initiator: boolean;
  state: LinkState;
  track: TTrack | null;
  cancelReset: (() => void) | null;
}

/**
 * Keeps one direct video link to every other player at the table (a full mesh),
 * and sends your camera over all of them.
 */
export class TableSession<TTrack> {
  private readonly members = new Map<string, Player>();
  private readonly spectators = new Map<string, Spectator>();
  private readonly links = new Map<string, LinkEntry<TTrack>>();
  private readonly listeners = new Set<(state: TableSessionState<TTrack>) => void>();
  private connection: SignalingConnectionState = 'connecting';
  private connectionReason: string | null = null;
  private selfId: string | null = null;
  private localTrack: TTrack | null = null;
  private cameraStatus: CameraStatus = 'off';
  private readonly cameraStatuses = new Map<string, CameraStatus>();
  private state: TableSessionState<TTrack>;
  private unsubscribeSignaling: Unsubscribe | null = null;
  private disposed = false;

  constructor(
    private readonly signaling: TableSignaling,
    private readonly linkFactory: PeerLinkFactory<TTrack>,
    private readonly options: TableSessionOptions,
  ) {
    this.state = this.buildState();
  }

  start(): void {
    this.unsubscribeSignaling ??= this.signaling.subscribe((event) => this.handle(event));
  }

  getState(): TableSessionState<TTrack> {
    return this.state;
  }

  subscribe(listener: (state: TableSessionState<TTrack>) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async setLocalTrack(track: TTrack | null): Promise<void> {
    this.localTrack = track;
    this.publish();
    await Promise.all([...this.links.values()].map((entry) => entry.link.setLocalTrack(track)));
  }

  /** Tells everyone at the table what your camera is doing, e.g. that it's reconnecting. */
  setCameraStatus(status: CameraStatus): void {
    if (status === this.cameraStatus) return;
    this.cameraStatus = status;
    for (const memberId of this.members.keys()) this.sendStatus(memberId);
    this.publish();
  }

  async getStats(memberId: string): Promise<LinkStats | null> {
    const entry = this.links.get(memberId);
    return entry ? entry.link.getStats() : null;
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribeSignaling?.();
    for (const memberId of [...this.links.keys()]) this.closeLink(memberId);
    this.listeners.clear();
  }

  private handle(event: SignalingEvent): void {
    if (this.disposed) return;
    switch (event.type) {
      case 'welcome':
        if (this.selfId !== null && this.selfId !== event.selfId) {
          // The host restarted and gave us a new id, so every link was set up under the old one.
          for (const memberId of [...this.links.keys()]) this.closeLink(memberId);
        }
        this.selfId = event.selfId;
        this.members.clear();
        for (const member of event.members) this.members.set(member.id, member);
        this.spectators.clear();
        for (const spectator of event.spectators ?? []) this.spectators.set(spectator.id, spectator);
        for (const memberId of [...this.links.keys()]) {
          if (!this.linksTo(memberId)) this.closeLink(memberId);
        }
        for (const memberId of [...this.cameraStatuses.keys()]) {
          if (!this.members.has(memberId)) this.cameraStatuses.delete(memberId);
        }
        // Tell everyone what our camera is doing: after a reconnect, they may have missed a change.
        for (const memberId of [...this.members.keys(), ...this.spectators.keys()]) {
          if (!this.linksTo(memberId)) continue;
          this.ensureLink(memberId);
          this.sendStatus(memberId);
        }
        break;
      case 'member-joined':
        this.members.set(event.member.id, event.member);
        this.ensureLink(event.member.id);
        this.sendStatus(event.member.id);
        break;
      case 'spectator-joined':
        this.spectators.set(event.spectator.id, event.spectator);
        if (this.linksTo(event.spectator.id)) {
          this.ensureLink(event.spectator.id);
          this.sendStatus(event.spectator.id);
        }
        break;
      case 'member-left':
        this.members.delete(event.memberId);
        this.spectators.delete(event.memberId);
        this.cameraStatuses.delete(event.memberId);
        this.closeLink(event.memberId);
        break;
      case 'signal':
        this.handleSignal(event.from, event.data);
        break;
      case 'connection':
        this.connection = event.state;
        this.connectionReason = event.reason ?? null;
        break;
    }
    this.publish();
  }

  /**
   * Whether there's a video link with this member: between players, and from each player to each spectator.
   * Spectators don't link with each other: they have nothing to send.
   */
  private linksTo(memberId: string): boolean {
    if (memberId === this.selfId) return false;
    if (this.members.has(memberId)) return true;
    return this.spectators.has(memberId) && this.selfId !== null && this.members.has(this.selfId);
  }

  private handleSignal(from: string, data: unknown): void {
    if (!this.linksTo(from)) return;
    if (isStatusMessage(data)) {
      this.cameraStatuses.set(from, data.status.camera);
      return;
    }
    if (!isEnvelope(data)) return;
    let entry = this.links.get(from);
    if (entry && data.gen < entry.generation) {
      return;
    }
    if (!entry || data.gen > entry.generation) {
      entry = this.createLink(from, data.gen);
    }
    void entry.link.handleSignal(data.body);
  }

  private sendStatus(memberId: string): void {
    if (memberId !== this.selfId && this.selfId !== null) {
      this.signaling.send(memberId, { status: { camera: this.cameraStatus } } satisfies StatusMessage);
    }
  }

  private ensureLink(memberId: string): void {
    if (this.selfId === null || memberId === this.selfId || this.links.has(memberId)) {
      return;
    }
    this.createLink(memberId, 0);
  }

  private createLink(memberId: string, generation: number): LinkEntry<TTrack> {
    this.closeLink(memberId);
    const initiator = this.selfId !== null && this.selfId < memberId;
    // Registered before the link exists, so events the link emits while it's being created aren't lost.
    const entry: LinkEntry<TTrack> = {
      link: placeholderLink(),
      generation,
      initiator,
      state: 'new',
      track: null,
      cancelReset: null,
    };
    this.links.set(memberId, entry);
    const isCurrent = () => this.links.get(memberId) === entry;
    entry.link = this.linkFactory.create({
      remoteId: memberId,
      initiator,
      localTrack: this.localTrack,
      watcher: this.spectators.has(memberId),
      events: {
        signal: (body) => {
          if (isCurrent()) this.signaling.send(memberId, { gen: generation, body } satisfies Envelope);
        },
        state: (state) => {
          if (!isCurrent()) return;
          entry.state = state;
          this.updateResetTimer(memberId, entry);
          this.publish();
        },
        remoteTrack: (track) => {
          if (!isCurrent()) return;
          entry.track = track;
          this.publish();
        },
      },
    });
    this.updateResetTimer(memberId, entry);
    return entry;
  }

  private updateResetTimer(memberId: string, entry: LinkEntry<TTrack>): void {
    if (!entry.initiator) {
      return;
    }
    if (entry.state === 'connected') {
      entry.cancelReset?.();
      entry.cancelReset = null;
      return;
    }
    entry.cancelReset ??= this.options.timers.setTimeout(() => {
      entry.cancelReset = null;
      if (this.links.get(memberId) === entry && entry.state !== 'connected' && this.members.has(memberId)) {
        this.createLink(memberId, entry.generation + 1);
        this.publish();
      }
    }, this.options.linkResetMs);
  }

  private closeLink(memberId: string): void {
    const entry = this.links.get(memberId);
    if (!entry) return;
    this.links.delete(memberId);
    entry.cancelReset?.();
    entry.link.close();
  }

  private publish(): void {
    if (this.disposed) return;
    this.state = this.buildState();
    for (const listener of this.listeners) listener(this.state);
  }

  private buildState(): TableSessionState<TTrack> {
    const seats = [...this.members.values()]
      .sort((a, b) => a.seat - b.seat)
      .map((player): SeatView<TTrack> => {
        if (player.id === this.selfId) {
          return { player, isSelf: true, track: this.localTrack, link: 'self', camera: this.cameraStatus };
        }
        const entry = this.links.get(player.id);
        return {
          player,
          isSelf: false,
          track: entry?.track ?? null,
          link: entry?.state ?? 'new',
          camera: this.cameraStatuses.get(player.id) ?? null,
        };
      });
    return {
      connection: this.connection,
      connectionReason: this.connectionReason,
      selfId: this.selfId,
      seats,
      spectators: [...this.spectators.values()],
      spectating: this.selfId !== null && this.spectators.has(this.selfId),
    };
  }
}

function placeholderLink<TTrack>(): PeerLink<TTrack> {
  return {
    handleSignal: async () => undefined,
    setLocalTrack: async () => undefined,
    getStats: async () => ({ route: 'unknown', roundTripMs: null, inbound: null, outbound: null }),
    close: () => undefined,
  };
}

function isStatusMessage(data: unknown): data is StatusMessage {
  if (typeof data !== 'object' || data === null || !('status' in data)) return false;
  const status = data.status as { camera?: unknown } | null;
  return status !== null && (status.camera === 'live' || status.camera === 'reconnecting' || status.camera === 'off');
}

function isEnvelope(data: unknown): data is Envelope {
  return (
    typeof data === 'object' &&
    data !== null &&
    'gen' in data &&
    typeof data.gen === 'number' &&
    Number.isInteger(data.gen) &&
    data.gen >= 0 &&
    'body' in data
  );
}
