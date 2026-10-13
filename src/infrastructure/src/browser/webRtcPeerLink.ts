import type {
  LinkStats,
  PeerLink,
  PeerLinkEvents,
  PeerLinkFactory,
  PeerLinkOptions,
} from '@commander-brawl/application';
import { LinkStatsReader } from './stats';

export interface WebRtcConfig {
  readonly iceServers: RTCIceServer[];
  /** Upper limit for the video we send to one player. */
  readonly maxBitrateBps: number;
  /** How long a dropped connection may try to recover by itself before we restart it. */
  readonly disconnectGraceMs?: number;
}

/** Public STUN servers. They only tell a computer its own public address; no video goes through them. */
export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

type LinkSignal =
  | { readonly description: RTCSessionDescriptionInit }
  | { readonly candidate: RTCIceCandidateInit };

export class WebRtcPeerLinkFactory implements PeerLinkFactory<MediaStreamTrack> {
  constructor(private readonly config: WebRtcConfig) {}

  create(options: PeerLinkOptions<MediaStreamTrack>): PeerLink<MediaStreamTrack> {
    return new WebRtcPeerLink(options, this.config);
  }
}

/**
 * One video connection to another player, in both directions.
 * Uses the "perfect negotiation" pattern, so either side can renegotiate without the two colliding.
 */
class WebRtcPeerLink implements PeerLink<MediaStreamTrack> {
  private readonly pc: RTCPeerConnection;
  private readonly events: PeerLinkEvents<MediaStreamTrack>;
  private readonly polite: boolean;
  private readonly initiator: boolean;
  private readonly stats = new LinkStatsReader();
  private transceiver: RTCRtpTransceiver | null = null;
  private localTrack: MediaStreamTrack | null;
  private makingOffer = false;
  private ignoreOffer = false;
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(
    options: PeerLinkOptions<MediaStreamTrack>,
    private readonly config: WebRtcConfig,
  ) {
    this.events = options.events;
    this.initiator = options.initiator;
    this.polite = !options.initiator;
    this.localTrack = options.localTrack;
    this.pc = new RTCPeerConnection({
      iceServers: config.iceServers,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
    });
    this.pc.onnegotiationneeded = () => void this.negotiate();
    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.events.signal({ candidate: candidate.toJSON() } satisfies LinkSignal);
    };
    this.pc.ontrack = ({ track }) => this.events.remoteTrack(track);
    this.pc.onconnectionstatechange = () => this.handleConnectionState();

    if (this.initiator) {
      // A single two-way video channel. The other side adopts it when the offer arrives.
      this.transceiver = this.pc.addTransceiver('video', {
        direction: 'sendrecv',
        sendEncodings: [{ maxBitrate: config.maxBitrateBps }],
      });
      if (this.localTrack) void this.replaceTrack(this.localTrack);
    }
    this.events.state('connecting');
  }

  async handleSignal(data: unknown): Promise<void> {
    if (this.closed || !isLinkSignal(data)) return;
    try {
      if ('description' in data) {
        await this.handleDescription(data.description);
      } else {
        try {
          await this.pc.addIceCandidate(data.candidate);
        } catch (error) {
          if (!this.ignoreOffer) throw error;
        }
      }
    } catch (error) {
      console.warn('[peer-link] signal failed', error);
    }
  }

  async setLocalTrack(track: MediaStreamTrack | null): Promise<void> {
    this.localTrack = track;
    if (this.transceiver && !this.closed) await this.replaceTrack(track);
  }

  async getStats(): Promise<LinkStats> {
    return this.stats.read(await this.pc.getStats());
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.clearDisconnectTimer();
    this.pc.close();
  }

  private async handleDescription(description: RTCSessionDescriptionInit): Promise<void> {
    const offerCollision =
      description.type === 'offer' && (this.makingOffer || this.pc.signalingState !== 'stable');
    this.ignoreOffer = !this.polite && offerCollision;
    if (this.ignoreOffer) return;

    await this.pc.setRemoteDescription(description);
    if (description.type === 'offer') {
      this.adoptTransceiver();
      await this.pc.setLocalDescription();
      if (this.pc.localDescription) this.events.signal({ description: this.pc.localDescription.toJSON() });
    }
    await this.tuneSender();
  }

  private async negotiate(): Promise<void> {
    if (this.closed) return;
    try {
      this.makingOffer = true;
      await this.pc.setLocalDescription();
      if (this.pc.localDescription) this.events.signal({ description: this.pc.localDescription.toJSON() });
    } catch (error) {
      console.warn('[peer-link] negotiation failed', error);
    } finally {
      this.makingOffer = false;
    }
  }

  /** The answering side takes over the video channel the initiator created and starts sending on it too. */
  private adoptTransceiver(): void {
    if (this.transceiver) return;
    const transceiver = this.pc.getTransceivers().find((t) => t.receiver.track.kind === 'video');
    if (!transceiver) return;
    this.transceiver = transceiver;
    transceiver.direction = 'sendrecv';
    void this.replaceTrack(this.localTrack);
  }

  private async replaceTrack(track: MediaStreamTrack | null): Promise<void> {
    try {
      await this.transceiver?.sender.replaceTrack(track);
      await this.tuneSender();
    } catch (error) {
      console.warn('[peer-link] could not switch camera', error);
    }
  }

  /**
   * Caps the bitrate. Sender parameters change while a negotiation is in progress, so this only
   * runs when it has settled; handleDescription calls it again once it has.
   */
  private async tuneSender(): Promise<void> {
    const sender = this.transceiver?.sender;
    if (!sender || this.closed || this.pc.signalingState !== 'stable') return;
    const params = sender.getParameters();
    if (!params.encodings || params.encodings.length === 0) return;
    let changed = false;
    for (const encoding of params.encodings) {
      if (encoding.maxBitrate !== this.config.maxBitrateBps) {
        encoding.maxBitrate = this.config.maxBitrateBps;
        changed = true;
      }
    }
    if (changed) {
      await sender.setParameters(params).catch((error: unknown) => console.warn('[peer-link] bitrate', error));
    }
  }

  private handleConnectionState(): void {
    if (this.closed) return;
    switch (this.pc.connectionState) {
      case 'new':
      case 'connecting':
        this.events.state('connecting');
        break;
      case 'connected':
        this.clearDisconnectTimer();
        this.events.state('connected');
        break;
      case 'disconnected':
        // Often recovers by itself within a few seconds (Wi-Fi hiccup). Restart if it doesn't.
        this.events.state('reconnecting');
        this.disconnectTimer ??= setTimeout(() => {
          this.disconnectTimer = null;
          if (this.pc.connectionState === 'disconnected') this.restartIce();
        }, this.config.disconnectGraceMs ?? 3_000);
        break;
      case 'failed':
        this.events.state('failed');
        this.restartIce();
        break;
      case 'closed':
        this.events.state('closed');
        break;
    }
  }

  private restartIce(): void {
    // Only one side restarts, so the two don't race each other.
    if (this.initiator && !this.closed) this.pc.restartIce();
  }

  private clearDisconnectTimer(): void {
    if (this.disconnectTimer) clearTimeout(this.disconnectTimer);
    this.disconnectTimer = null;
  }
}

function isLinkSignal(data: unknown): data is LinkSignal {
  if (typeof data !== 'object' || data === null) return false;
  if ('description' in data) {
    const description = data.description as Record<string, unknown> | null;
    return (
      typeof description === 'object' &&
      description !== null &&
      (description.type === 'offer' || description.type === 'answer') &&
      typeof description.sdp === 'string'
    );
  }
  if ('candidate' in data) {
    const candidate = data.candidate as Record<string, unknown> | null;
    return typeof candidate === 'object' && candidate !== null && typeof candidate.candidate === 'string';
  }
  return false;
}
