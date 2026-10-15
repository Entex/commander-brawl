import type {
  LinkStats,
  PeerLink,
  PeerLinkEvents,
  PeerLinkFactory,
  PeerLinkOptions,
} from '@commander-brawl/application';
import { LinkStatsReader } from './stats';
import { UploadBudget, type SendPlan, type SentHeight } from './uploadBudget';

export interface WebRtcConfig {
  readonly iceServers: RTCIceServer[];
  /** Upper limit for the video we send to one player. */
  readonly maxBitrateBps: number;
  /** Upper limit for the video we send to one watcher. */
  readonly watcherBitrateBps?: number;
  /** How long a dropped connection may try to recover by itself before we restart it. */
  readonly disconnectGraceMs?: number;
  /** How often each link checks how its video is getting through, and adjusts. */
  readonly checkEveryMs?: number;
}

/** A watcher's video: they don't need it sharp enough for close-ups. */
const WATCHER_BITRATE_BPS = 1_200_000;

/**
 * A public STUN server: Cloudflare's, which they offer free to anyone. It only tells a computer its own public
 * address; no video goes through it.
 */
export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.cloudflare.com:3478' }];

type LinkSignal = { readonly description: RTCSessionDescriptionInit } | { readonly candidate: RTCIceCandidateInit };

export class WebRtcPeerLinkFactory implements PeerLinkFactory<MediaStreamTrack> {
  /** What this player sends, shared out across all their links. */
  private readonly budget: UploadBudget;
  private readonly links = new Set<WebRtcPeerLink>();

  constructor(private readonly config: WebRtcConfig) {
    this.budget = new UploadBudget({
      playerBps: config.maxBitrateBps,
      watcherBps: config.watcherBitrateBps ?? WATCHER_BITRATE_BPS,
    });
  }

  create(options: PeerLinkOptions<MediaStreamTrack>): PeerLink<MediaStreamTrack> {
    const link = new WebRtcPeerLink(options, this.config, this.budget, () => this.links.delete(link));
    this.links.add(link);
    return link;
  }

  /** How sharp the video sent to the others is to be, for every link from now on. */
  setSentHeight(height: SentHeight): void {
    if (height === this.budget.sentHeight) return;
    this.budget.setSentHeight(height);
    for (const link of this.links) link.retune();
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
  /** Its own, so the rates it works out aren't thrown off by the stats shown on screen. */
  private readonly checkStats = new LinkStatsReader();
  private checkTimer: ReturnType<typeof setInterval> | null = null;
  private transceiver: RTCRtpTransceiver | null = null;
  private localTrack: MediaStreamTrack | null;
  private makingOffer = false;
  private ignoreOffer = false;
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(
    options: PeerLinkOptions<MediaStreamTrack>,
    private readonly config: WebRtcConfig,
    private readonly budget: UploadBudget,
    private readonly onClosed: () => void = () => undefined,
  ) {
    this.events = options.events;
    budget.join(this, options.watcher ?? false);
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
        sendEncodings: [encodingFor(budget.planFor(this), this.localTrack)],
      });
      if (this.localTrack) void this.replaceTrack(this.localTrack);
    }
    this.events.state('connecting');
    // How the video gets through, now and then: the budget shares out what there's room for.
    this.checkTimer = setInterval(() => void this.check(), config.checkEveryMs ?? 2_000);
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
    if (this.checkTimer) clearInterval(this.checkTimer);
    this.budget.leave(this);
    this.onClosed();
    this.pc.close();
  }

  /** Sends as the budget now says (the player chose how sharp). */
  retune(): void {
    void this.tuneSender();
  }

  /** Reports how the video sent is getting through, and sends as the budget then says. */
  private async check(): Promise<void> {
    if (this.closed || !this.localTrack || this.pc.connectionState !== 'connected') return;
    try {
      const { outbound } = this.checkStats.read(await this.pc.getStats());
      if (!outbound) return;
      this.budget.report(this, {
        sentBps: outbound.kbps * 1000,
        fps: outbound.fps,
        limitation: outbound.limitation ?? null,
      });
      await this.tuneSender();
    } catch (error) {
      console.warn('[peer-link] check', error);
    }
  }

  private async handleDescription(description: RTCSessionDescriptionInit): Promise<void> {
    const offerCollision = description.type === 'offer' && (this.makingOffer || this.pc.signalingState !== 'stable');
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
   * Sends as the budget says: how many bits, how big a picture, how many frames. Sender parameters change while a
   * negotiation is in progress, so this only runs when it has settled; handleDescription calls it again once it has.
   */
  private async tuneSender(): Promise<void> {
    const sender = this.transceiver?.sender;
    if (!sender || this.closed || this.pc.signalingState !== 'stable') return;
    const params = sender.getParameters();
    if (!params.encodings || params.encodings.length === 0) return;
    const wanted = encodingFor(this.budget.planFor(this), this.localTrack);
    let changed = false;
    for (const encoding of params.encodings) {
      // Small changes in the bitrate aren't worth telling the encoder about.
      const bitrate = encoding.maxBitrate ?? 0;
      if (Math.abs(bitrate - wanted.maxBitrate!) > wanted.maxBitrate! * 0.05) {
        encoding.maxBitrate = wanted.maxBitrate;
        changed = true;
      }
      if (Math.abs((encoding.scaleResolutionDownBy ?? 1) - wanted.scaleResolutionDownBy!) > 0.01) {
        encoding.scaleResolutionDownBy = wanted.scaleResolutionDownBy;
        changed = true;
      }
      if (encoding.maxFramerate !== wanted.maxFramerate) {
        if (wanted.maxFramerate === undefined) delete encoding.maxFramerate;
        else encoding.maxFramerate = wanted.maxFramerate;
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

/** The sender's encoding for a plan: the camera's picture made smaller, if it's bigger than the plan allows. */
function encodingFor(plan: SendPlan, track: MediaStreamTrack | null): RTCRtpEncodingParameters {
  const { width, height } = track?.getSettings() ?? {};
  const longSide = width && height ? Math.max(width, height) : 1920;
  return {
    maxBitrate: plan.maxBitrateBps,
    scaleResolutionDownBy: Math.max(1, Math.round((longSide / plan.maxLongSide) * 100) / 100),
    ...(plan.maxFramerate === undefined ? {} : { maxFramerate: plan.maxFramerate }),
  };
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
