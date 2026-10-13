// A bare player for browser tests: the real TableSession and WebRTC links, with signaling
// bridged to the test process instead of the Electron main process.
import { TableSession, type SignalingEvent, type TableSignaling } from '@commander-brawl/application';
import {
  openCamera,
  PhoneReceiver,
  WebRtcPeerLinkFactory,
  type PhoneCameraState,
} from '@commander-brawl/infrastructure/browser';
import type { DesktopToPhone, PhoneToDesktop } from '@commander-brawl/infrastructure/protocol';

export type HarnessOutbound =
  | { readonly kind: 'signal'; readonly to: string; readonly data: unknown }
  | { readonly kind: 'phone'; readonly message: DesktopToPhone };

export interface VideoReport {
  readonly memberId: string;
  readonly link: string;
  readonly width: number;
  readonly height: number;
  readonly frames: number;
  readonly paused: boolean;
}

declare global {
  interface Window {
    toNode(message: HarnessOutbound): Promise<void>;
    harness: typeof harness;
  }
}

class BridgeSignaling implements TableSignaling {
  private listener: ((event: SignalingEvent) => void) | null = null;

  subscribe(listener: (event: SignalingEvent) => void) {
    this.listener = listener;
    return () => (this.listener = null);
  }

  send(to: string, data: unknown): void {
    void window.toNode({ kind: 'signal', to, data });
  }

  deliver(event: SignalingEvent): void {
    this.listener?.(event);
  }
}

const signaling = new BridgeSignaling();
const session = new TableSession(
  signaling,
  new WebRtcPeerLinkFactory({ iceServers: [], maxBitrateBps: 3_000_000, disconnectGraceMs: 1_000 }),
  {
    timers: {
      setTimeout: (callback, ms) => {
        const handle = setTimeout(callback, ms);
        return () => clearTimeout(handle);
      },
      now: () => Date.now(),
    },
    linkResetMs: 8_000,
  },
);
session.start();

const videos = new Map<string, HTMLVideoElement>();
/** Every camera status each other player has reported, in order. */
const cameraHistory = new Map<string, string[]>();
session.subscribe((state) => {
  for (const seat of state.seats) {
    if (seat.isSelf || seat.camera === null) continue;
    const history = cameraHistory.get(seat.player.id) ?? [];
    if (history.at(-1) !== seat.camera) cameraHistory.set(seat.player.id, [...history, seat.camera]);
  }
});
session.subscribe((state) => {
  for (const seat of state.seats) {
    if (seat.isSelf) continue;
    let video = videos.get(seat.player.id);
    if (!video) {
      video = Object.assign(document.createElement('video'), { autoplay: true, muted: true, playsInline: true });
      document.body.append(video);
      videos.set(seat.player.id, video);
    }
    const current = (video.srcObject as MediaStream | null)?.getVideoTracks()[0];
    if (seat.track && current !== seat.track) {
      video.srcObject = new MediaStream([seat.track]);
      void video.play().catch(() => undefined);
    }
  }
});

let phoneReceiver: PhoneReceiver | null = null;
let phoneState: PhoneCameraState = 'waiting';

const harness = {
  deliver(event: SignalingEvent): void {
    signaling.deliver(event);
  },

  async useFakeCamera(): Promise<void> {
    await session.setLocalTrack(await openCamera());
  },

  /** Act like the desktop app with a linked phone: the phone's camera is what we send to the others. */
  startPhoneReceiver(): void {
    phoneReceiver = new PhoneReceiver({
      send: (message) => void window.toNode({ kind: 'phone', message }),
      track: (track) => void session.setLocalTrack(track),
      state: (state) => {
        phoneState = state;
        // What the desktop app tells the other players (see cameraStatus in the desktop app).
        session.setCameraStatus(state === 'live' ? 'live' : state === 'waiting' ? 'off' : 'reconnecting');
      },
    });
  },

  deliverPhone(message: PhoneToDesktop): void {
    void phoneReceiver?.handle(message);
  },

  phoneDisconnected(): void {
    phoneReceiver?.phoneDisconnected();
  },

  phoneState(): PhoneCameraState {
    return phoneState;
  },

  cameraHistory(memberId: string): string[] {
    return cameraHistory.get(memberId) ?? [];
  },

  videoReport(): VideoReport[] {
    return session
      .getState()
      .seats.filter((seat) => !seat.isSelf)
      .map((seat) => {
        const video = videos.get(seat.player.id);
        return {
          memberId: seat.player.id,
          link: seat.link,
          width: video?.videoWidth ?? 0,
          height: video?.videoHeight ?? 0,
          frames: video?.getVideoPlaybackQuality().totalVideoFrames ?? 0,
          paused: video?.paused ?? true,
        };
      });
  },

  async route(memberId: string): Promise<string | null> {
    return (await session.getStats(memberId))?.route ?? null;
  },
};

window.harness = harness;
