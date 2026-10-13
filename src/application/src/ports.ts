import type { Player } from '@commander-brawl/domain';

export type Unsubscribe = () => void;

export interface Timers {
  /** Runs callback after ms milliseconds. Returns a function that cancels it. */
  setTimeout(callback: () => void, ms: number): () => void;
  now(): number;
}

export type SignalingConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'closed';

export type SignalingEvent =
  | { readonly type: 'welcome'; readonly selfId: string; readonly members: readonly Player[] }
  | { readonly type: 'member-joined'; readonly member: Player }
  | { readonly type: 'member-left'; readonly memberId: string }
  | { readonly type: 'signal'; readonly from: string; readonly data: unknown }
  | { readonly type: 'connection'; readonly state: SignalingConnectionState; readonly reason?: string };

/** Connection to the table host, used to find the other players and exchange connection details with them. */
export interface TableSignaling {
  subscribe(listener: (event: SignalingEvent) => void): Unsubscribe;
  send(to: string, data: unknown): void;
}

export type LinkState = 'new' | 'connecting' | 'connected' | 'reconnecting' | 'failed' | 'closed';

export interface VideoStats {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly kbps: number;
  /** Share of packets lost since the previous sample, 0–100. */
  readonly lossPercent: number;
}

export interface LinkStats {
  /** Whether video flows straight between the two computers or through a relay. */
  readonly route: 'direct' | 'relay' | 'unknown';
  readonly roundTripMs: number | null;
  readonly inbound: VideoStats | null;
  readonly outbound: VideoStats | null;
}

export interface PeerLinkEvents<TTrack> {
  signal(data: unknown): void;
  state(state: LinkState): void;
  remoteTrack(track: TTrack | null): void;
}

/** A direct video connection to one other player. */
export interface PeerLink<TTrack> {
  handleSignal(data: unknown): Promise<void>;
  setLocalTrack(track: TTrack | null): Promise<void>;
  getStats(): Promise<LinkStats>;
  close(): void;
}

export interface PeerLinkOptions<TTrack> {
  readonly remoteId: string;
  /** Exactly one side of each pair is the initiator. It opens the connection and resolves conflicts. */
  readonly initiator: boolean;
  readonly localTrack: TTrack | null;
  readonly events: PeerLinkEvents<TTrack>;
}

export interface PeerLinkFactory<TTrack> {
  create(options: PeerLinkOptions<TTrack>): PeerLink<TTrack>;
}
