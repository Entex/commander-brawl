// A bare player for browser tests: the real TableSession and WebRTC links, with signaling
// bridged to the test process instead of the Electron main process.
import {
  CardIdentifier,
  CardIndex,
  TableSession,
  type Quad,
  type SignalingEvent,
  type TableSignaling,
} from '@commander-brawl/application';
import type { Card } from '@commander-brawl/domain';
import {
  dataUrlToRgba,
  openCamera,
  PhoneReceiver,
  Straightener,
  TesseractReader,
  WebRtcPeerLinkFactory,
  type PhoneCameraState,
} from '@commander-brawl/infrastructure/browser';
// The same Tesseract files the desktop app ships.
import languageUrl from '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz?url';
import coreUrl from 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js?url';
import workerUrl from 'tesseract.js/dist/worker.min.js?url';
import type { DesktopToPhone, PhoneCrop, PhoneToDesktop } from '@commander-brawl/infrastructure/protocol';

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

const testCard = (name: string): Card => ({
  id: name,
  name,
  layout: 'normal',
  manaCost: '',
  typeLine: '',
  oracleText: '',
  stats: '',
  colorIdentity: [],
  manaValue: 0,
  commander: 'legal',
  gameChanger: false,
  image: null,
  faces: [],
});
const catalog = new CardIndex(
  ['Rhystic Study', 'Rhystic Tutor', 'Sol Ring', 'Mystic Remora', 'Study Hall'].map(testCard),
);
const identifier = new CardIdentifier(
  new TesseractReader({
    workerUrl,
    coreUrl,
    languageFolderUrl: languageUrl.slice(0, languageUrl.lastIndexOf('/') + 1),
  }),
  { closest: async (texts) => catalog.closest(texts) },
  { print: async () => null },
);

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

  /** Asks the linked phone for a sharp picture of part of its view. Its size and type, or the error. */
  async phoneSnapshot(crop: PhoneCrop): Promise<{ width: number; height: number; type: string } | string> {
    if (!phoneReceiver) return 'no phone receiver';
    try {
      const image = await phoneReceiver.requestSnapshot(crop);
      const element = new Image();
      element.src = image;
      await element.decode();
      return { width: element.naturalWidth, height: element.naturalHeight, type: image.slice(5, image.indexOf(';')) };
    } catch (error) {
      return (error as Error).message;
    }
  },

  /** Which card is in this picture (a data URL), with Tesseract really reading it. */
  async identifyCard(picture: string): Promise<{ found: boolean; guesses: { name: string; score: number }[] }> {
    const result = await identifier.identify(await dataUrlToRgba(picture));
    return {
      found: result.picture !== null,
      guesses: result.guesses.map((guess) => ({ name: guess.card.name, score: guess.score })),
    };
  },

  /**
   * Straightens a test picture (top left red, top right blue, bottom left green, bottom right yellow) with
   * these corners, and reports the straight picture's size and the color in the middle of each quarter.
   */
  async straightenTestPicture(corners: Quad): Promise<{ width: number; height: number; colors: string[] }> {
    const source = Object.assign(document.createElement('canvas'), { width: 640, height: 480 });
    const draw = () => {
      const g = source.getContext('2d')!;
      [
        ['#f00', 0, 0],
        ['#00f', 320, 0],
        ['#0f0', 0, 240],
        ['#ff0', 320, 240],
      ].forEach(([color, x, y]) => {
        g.fillStyle = color as string;
        g.fillRect(x as number, y as number, 320, 240);
      });
    };
    draw();
    const painter = setInterval(draw, 30);
    const straightener = new Straightener(source.captureStream(30).getVideoTracks()[0]!, corners, 320, 180);
    const video = Object.assign(document.createElement('video'), { muted: true, playsInline: true });
    document.body.append(video);
    video.srcObject = new MediaStream([straightener.track]);
    await video.play();
    while (video.getVideoPlaybackQuality().totalVideoFrames < 3) await new Promise((r) => setTimeout(r, 50));
    const out = Object.assign(document.createElement('canvas'), { width: video.videoWidth, height: video.videoHeight });
    const g = out.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(video, 0, 0);
    const colorAt = (fx: number, fy: number) => {
      const [r, gr, b] = g.getImageData(Math.floor(fx * out.width), Math.floor(fy * out.height), 1, 1).data;
      return [r! > 128 ? 'r' : '', gr! > 128 ? 'g' : '', b! > 128 ? 'b' : ''].join('');
    };
    const result = {
      width: video.videoWidth,
      height: video.videoHeight,
      colors: [colorAt(0.25, 0.25), colorAt(0.75, 0.25), colorAt(0.25, 0.75), colorAt(0.75, 0.75)],
    };
    clearInterval(painter);
    straightener.stop();
    video.remove();
    return result;
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
