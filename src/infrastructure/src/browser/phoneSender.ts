import {
  PHONE_REPLACED_CLOSE_CODE,
  parseDesktopToPhone,
  type CameraHeight,
  type DesktopToPhone,
  type PhoneCrop,
  type PhoneToDesktop,
} from '../protocol';
import { capturePhoto, warmUpPhotos } from './capture';
import { cameraConstraints } from './webcam';

export type PhoneSenderStatus =
  | { readonly kind: 'starting' }
  | { readonly kind: 'connecting' }
  | { readonly kind: 'live' }
  | { readonly kind: 'reconnecting' }
  | { readonly kind: 'replaced' }
  | { readonly kind: 'camera-error'; readonly message: string };

export interface CameraControls {
  readonly zoom: { readonly min: number; readonly max: number; readonly step: number; readonly value: number } | null;
  readonly torch: boolean | null;
}

export interface PhoneSenderOptions {
  /** wss:// address of the desktop app, including the link token. */
  readonly signalingUrl: string;
  onStatus(status: PhoneSenderStatus): void;
  onPreview(stream: MediaStream | null): void;
  onControls(controls: CameraControls): void;
}

/** Bitrate over the local Wi-Fi, by resolution. High, so the desktop gets a sharp picture to pass on. */
const BITRATES_BPS: Record<CameraHeight, number> = { 720: 4_000_000, 1080: 8_000_000, 2160: 20_000_000 };

const RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 3_000];
const PING_INTERVAL_MS = 4_000;
const SILENCE_TIMEOUT_MS = 12_000;

type FacingMode = 'environment' | 'user';

/**
 * Runs on the phone. Streams the camera to the player's own desktop app and recovers by itself
 * from Wi-Fi drops, the screen locking, and the browser stopping the camera in the background.
 */
export class PhoneSender {
  private ws: WebSocket | null = null;
  private pc: RTCPeerConnection | null = null;
  private sender: RTCRtpSender | null = null;
  private track: MediaStreamTrack | null = null;
  private facingMode: FacingMode = 'environment';
  /** Until the desktop says otherwise. */
  private height: CameraHeight = 1080;
  private session = 0;
  private attempt = 0;
  private stopped = false;
  private wakeLock: WakeLockSentinel | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: PhoneSenderOptions) {}

  async start(): Promise<void> {
    this.options.onStatus({ kind: 'starting' });
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    if (!(await this.acquireCamera())) return;
    void this.keepScreenOn();
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.clearTimers();
    this.ws?.close();
    this.pc?.close();
    this.track?.stop();
    void this.wakeLock?.release();
  }

  async switchCamera(): Promise<void> {
    this.facingMode = this.facingMode === 'environment' ? 'user' : 'environment';
    await this.acquireCamera();
  }

  async setZoom(value: number): Promise<void> {
    await this.applyAdvanced({ zoom: value });
  }

  async setTorch(on: boolean): Promise<void> {
    await this.applyAdvanced({ torch: on });
  }

  private readonly onVisibilityChange = () => {
    if (document.visibilityState !== 'visible' || this.stopped) return;
    // Phones often stop the camera while the page is hidden. Get it back and reconnect if needed.
    void this.keepScreenOn();
    if (!this.track || this.track.readyState === 'ended') void this.acquireCamera();
    if (!this.ws) {
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
      this.connect();
    }
  };

  private async acquireCamera(): Promise<boolean> {
    let track: MediaStreamTrack | undefined;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: this.facingMode }, ...cameraConstraints(this.height) },
      });
      track = stream.getVideoTracks()[0];
    } catch (error) {
      this.options.onStatus({ kind: 'camera-error', message: cameraErrorMessage(error) });
      return false;
    }
    if (!track) {
      this.options.onStatus({ kind: 'camera-error', message: 'No camera found.' });
      return false;
    }

    // Tell the encoder to keep text sharp and drop frames instead of resolution when bandwidth is short.
    track.contentHint = 'detail';
    track.onended = () => {
      if (!this.stopped && document.visibilityState === 'visible') void this.acquireCamera();
    };
    await track
      .applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] })
      .catch(() => undefined);

    const previous = this.track;
    this.track = track;
    previous?.stop();
    this.options.onPreview(new MediaStream([track]));
    this.options.onControls(readControls(track));
    warmUpPhotos(track);
    await this.sender?.replaceTrack(track).catch(() => this.startPeer());
    return true;
  }

  /** Films at this resolution from now on, as picked on the computer. */
  private async setResolution(height: CameraHeight): Promise<void> {
    if (height === this.height) return;
    this.height = height;
    // Started over rather than changed: changed in place, an iPhone's photos come out black or of the wrong part.
    // Stopped first, so that nothing of the old camera is kept.
    this.track?.stop();
    await this.acquireCamera();
    const params = this.sender?.getParameters();
    const encoding = params?.encodings?.[0];
    if (!this.sender || !params || !encoding) return;
    encoding.maxBitrate = BITRATES_BPS[height];
    await this.sender.setParameters(params).catch((error: unknown) => console.warn('[phone] bitrate', error));
  }

  private connect(): void {
    if (this.stopped) return;
    this.options.onStatus({ kind: this.attempt === 0 ? 'connecting' : 'reconnecting' });
    const ws = new WebSocket(this.options.signalingUrl);
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.startHeartbeat();
      this.startPeer();
    };
    ws.onmessage = ({ data }) => {
      this.resetSilenceTimer();
      const message = typeof data === 'string' ? parseDesktopToPhone(data) : null;
      if (message) void this.handle(message);
    };
    ws.onclose = ({ code }) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.stopHeartbeat();
      if (code === PHONE_REPLACED_CLOSE_CODE) {
        this.stop();
        this.options.onStatus({ kind: 'replaced' });
        return;
      }
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    this.options.onStatus({ kind: 'reconnecting' });
    const delay = RECONNECT_DELAYS_MS[Math.min(this.attempt, RECONNECT_DELAYS_MS.length - 1)]!;
    this.attempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  /** A fresh video connection. Cheap on the local network, so we start over instead of repairing. */
  private startPeer(): void {
    if (this.stopped || !this.track || this.ws?.readyState !== WebSocket.OPEN) return;
    this.pc?.close();
    const session = ++this.session;
    const pc = new RTCPeerConnection({ iceServers: [] });
    this.pc = pc;
    const transceiver = pc.addTransceiver(this.track, {
      direction: 'sendonly',
      sendEncodings: [{ maxBitrate: BITRATES_BPS[this.height] }],
    });
    this.sender = transceiver.sender;

    pc.onicecandidate = ({ candidate }) => {
      if (!candidate || this.pc !== pc) return;
      const { sdpMid = null, sdpMLineIndex = null } = candidate;
      this.send({ t: 'candidate', session, candidate: { candidate: candidate.candidate, sdpMid, sdpMLineIndex } });
    };
    pc.onconnectionstatechange = () => {
      if (this.pc !== pc) return;
      if (pc.connectionState === 'connected') this.options.onStatus({ kind: 'live' });
      if (pc.connectionState === 'failed') this.startPeer();
      if (pc.connectionState === 'disconnected') this.options.onStatus({ kind: 'reconnecting' });
    };

    void (async () => {
      try {
        await pc.setLocalDescription();
        if (this.pc === pc && pc.localDescription) this.send({ t: 'offer', session, sdp: pc.localDescription.sdp });
      } catch (error) {
        console.warn('[phone] offer failed', error);
      }
    })();
  }

  private async handle(message: DesktopToPhone): Promise<void> {
    if (message.t === 'snapshot') {
      await this.takeSnapshot(message.id, message.crop, message.margin);
      return;
    }
    if (message.t === 'resolution') {
      await this.setResolution(message.height);
      return;
    }
    if (message.t === 'pong' || message.session !== this.session || !this.pc) return;
    try {
      if (message.t === 'answer') {
        await this.pc.setRemoteDescription({ type: 'answer', sdp: message.sdp });
      } else {
        await this.pc.addIceCandidate(message.candidate);
      }
    } catch (error) {
      console.warn('[phone] could not apply message', error);
    }
  }

  /** A full-resolution photo of part of the view, for a player who wants to read a card on this table. */
  private async takeSnapshot(id: string, crop: PhoneCrop, margin?: number): Promise<void> {
    if (!this.track || this.track.readyState !== 'live') {
      this.send({ t: 'snapshot-failed', id, message: 'The camera is off.' });
      return;
    }
    try {
      this.send({ t: 'snapshot', id, image: await capturePhoto(this.track, crop, margin) });
    } catch (error) {
      this.send({ t: 'snapshot-failed', id, message: (error as Error).message });
    }
  }

  private send(message: PhoneToDesktop): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.resetSilenceTimer();
    this.pingTimer = setInterval(() => this.send({ t: 'ping' }), PING_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.pingTimer = null;
    this.silenceTimer = null;
  }

  /** A Wi-Fi drop can leave the socket looking open. If the desktop goes quiet, reconnect. */
  private resetSilenceTimer(): void {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = setTimeout(() => this.ws?.close(), SILENCE_TIMEOUT_MS);
  }

  private clearTimers(): void {
    this.stopHeartbeat();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private async keepScreenOn(): Promise<void> {
    if (!('wakeLock' in navigator) || (this.wakeLock && !this.wakeLock.released)) return;
    try {
      this.wakeLock = await navigator.wakeLock.request('screen');
    } catch {
      // Not allowed right now (e.g. low battery mode). We try again when the page becomes visible.
    }
  }

  private async applyAdvanced(constraints: Record<string, unknown>): Promise<void> {
    if (!this.track) return;
    try {
      await this.track.applyConstraints({ advanced: [constraints as MediaTrackConstraintSet] });
      this.options.onControls(readControls(this.track));
    } catch (error) {
      console.warn('[phone] camera setting not supported', error);
    }
  }
}

function readControls(track: MediaStreamTrack): CameraControls {
  const capabilities = (track.getCapabilities?.() ?? {}) as Record<string, unknown>;
  const settings = track.getSettings() as Record<string, unknown>;
  const zoom = capabilities.zoom as { min?: number; max?: number; step?: number } | undefined;
  return {
    zoom:
      zoom && typeof zoom.min === 'number' && typeof zoom.max === 'number' && zoom.max > zoom.min
        ? {
            min: zoom.min,
            max: zoom.max,
            step: zoom.step ?? 0.1,
            value: typeof settings.zoom === 'number' ? settings.zoom : zoom.min,
          }
        : null,
    torch: capabilities.torch === true ? settings.torch === true : null,
  };
}

function cameraErrorMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : '';
  switch (name) {
    case 'NotAllowedError':
      return 'Camera access was blocked. Allow the camera for this page in your browser settings, then reload.';
    case 'NotFoundError':
      return 'No camera found.';
    case 'NotReadableError':
      return 'The camera is busy. Close other apps using it, then reload.';
    default:
      return `Could not start the camera${error instanceof Error ? `: ${error.message}` : '.'}`;
  }
}
