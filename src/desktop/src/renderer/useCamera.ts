import {
  cameraConstraints,
  captureFrame,
  dataUrlToRgba,
  likeness,
  listCameras,
  openCamera,
  PhoneReceiver,
  rgbaToDataUrl,
  Straightener,
  widen,
  type CameraDevice,
  type PhoneCameraState,
  SENT_HEIGHTS,
  type SentHeight,
} from '@commander-brawl/infrastructure/browser';
import { isCameraHeight, type CameraHeight } from '@commander-brawl/infrastructure/protocol';
import {
  cropInCamera,
  shrunkSize,
  squareToQuad,
  straightenedSize,
  warpCrop,
  WHOLE_PICTURE,
  type CameraStatus,
  type CropRect,
  type Quad,
} from '@commander-brawl/application';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from './api';

export type CameraSource = 'phone' | 'webcam';

/** What to tell the other players about your camera. */
export function cameraStatus(camera: CameraState): CameraStatus {
  if (camera.source === 'webcam') return camera.track ? 'live' : 'off';
  switch (camera.phone.state) {
    case 'live':
      return 'live';
    case 'connecting':
    case 'reconnecting':
      return 'reconnecting';
    case 'waiting':
      return 'off';
  }
}

export interface CameraState {
  readonly source: CameraSource;
  /** The camera other players see: straightened, if it's set up that way. */
  readonly track: MediaStreamTrack | null;
  /** The camera as it is, for choosing the corners to straighten it by. */
  readonly rawTrack: MediaStreamTrack | null;
  readonly straighten: {
    /** Whether this computer can straighten a camera. */
    readonly supported: boolean;
    /** The playmat's corners in the camera picture, while the camera is straightened. */
    readonly corners: Quad | null;
    /** Why the camera isn't straightened even though there are corners. */
    readonly error: string | null;
    /** Straightens the camera by these corners (remembered for this camera), or (null) stops. */
    set(corners: Quad | null): void;
  };
  readonly phone: {
    readonly state: PhoneCameraState;
    readonly urls: readonly string[];
  };
  readonly webcam: {
    readonly devices: readonly CameraDevice[];
    readonly deviceId: string | null;
    readonly error: string | null;
  };
  /**
   * How sharp the camera films (remembered). The others get at most 1080p either way: more makes close-ups
   * sharper, and a straightened view too.
   */
  readonly resolution: CameraHeight;
  setResolution(resolution: CameraHeight): void;
  /**
   * How sharp the video sent to the others is (remembered): at most the camera's, and smaller if the connection
   * struggles. Close-ups come from the camera itself, so they stay as sharp as it films.
   */
  readonly sent: SentHeight;
  setSent(sent: SentHeight): void;
  selectPhone(): void;
  selectWebcam(deviceId: string): Promise<void>;
  refreshDevices(): Promise<void>;
  /** A sharp picture of part of your camera view, for another player who wants to read a card. */
  snapshot(crop: CropRect): Promise<string>;
}

/** Your camera: a phone linked over Wi-Fi (preferred) or a webcam on this computer. */
export function useCamera(): CameraState {
  const [source, setSource] = useState<CameraSource>('phone');
  const [phoneTrack, setPhoneTrack] = useState<MediaStreamTrack | null>(null);
  const [phoneState, setPhoneState] = useState<PhoneCameraState>('waiting');
  const [urls, setUrls] = useState<readonly string[]>([]);
  const [devices, setDevices] = useState<readonly CameraDevice[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [webcamTrack, setWebcamTrack] = useState<MediaStreamTrack | null>(null);
  const [webcamError, setWebcamError] = useState<string | null>(null);
  const webcamTrackRef = useRef<MediaStreamTrack | null>(null);
  const [resolution, setResolutionState] = useState(loadResolution);
  const [sent, setSentState] = useState(loadSent);

  const receiverRef = useRef<PhoneReceiver | null>(null);

  useEffect(() => {
    const receiver = new PhoneReceiver({
      send: (message) => api.phone.send(message),
      track: setPhoneTrack,
      state: (state) => {
        setPhoneState(state);
        // Scanning the QR code means "use my phone", so switch to it as soon as it's live.
        if (state === 'live') setSource('phone');
      },
    });
    receiverRef.current = receiver;
    const off = api.phone.onEvent((event) => {
      if (event.type === 'message') void receiver.handle(event.message);
      if (event.type === 'disconnected') receiver.phoneDisconnected();
    });
    void api.phone.info().then((info) => setUrls(info.urls));
    return () => {
      off();
      receiver.close();
      receiverRef.current = null;
    };
  }, []);

  const setResolution = useCallback((next: CameraHeight) => {
    localStorage.setItem(RESOLUTION_KEY, String(next));
    setResolutionState(next);
  }, []);

  const setSent = useCallback((next: SentHeight) => {
    localStorage.setItem(SENT_KEY, String(next));
    setSentState(next);
  }, []);

  // The phone films at it; a webcam that's on changes to it.
  useEffect(() => {
    receiverRef.current?.setResolution(resolution);
    webcamTrackRef.current
      ?.applyConstraints(cameraConstraints(resolution))
      .catch((error: unknown) => setWebcamError(errorMessage(error)));
  }, [resolution]);

  const stopWebcam = useCallback(() => {
    webcamTrackRef.current?.stop();
    webcamTrackRef.current = null;
    setWebcamTrack(null);
  }, []);

  const refreshDevices = useCallback(async () => {
    try {
      setDevices(await listCameras());
    } catch (error) {
      setWebcamError(errorMessage(error));
    }
  }, []);

  const selectWebcam = useCallback(
    async (id: string) => {
      setWebcamError(null);
      try {
        const track = await openCamera(id || undefined, resolution);
        stopWebcam();
        webcamTrackRef.current = track;
        setWebcamTrack(track);
        setDeviceId(id);
        setSource('webcam');
        // Labels are only available after the first camera permission.
        void refreshDevices();
      } catch (error) {
        setWebcamError(errorMessage(error));
      }
    },
    [refreshDevices, stopWebcam, resolution],
  );

  const selectPhone = useCallback(() => {
    stopWebcam();
    setSource('phone');
  }, [stopWebcam]);

  useEffect(() => {
    let active = true;
    const load = () => {
      listCameras()
        .then((list) => active && setDevices(list))
        .catch((error: unknown) => active && setWebcamError(errorMessage(error)));
    };
    load();
    navigator.mediaDevices.addEventListener('devicechange', load);
    return () => {
      active = false;
      navigator.mediaDevices.removeEventListener('devicechange', load);
      stopWebcam();
    };
  }, [stopWebcam]);

  const rawTrack = source === 'phone' ? phoneTrack : webcamTrack;
  const cameraKey = source === 'phone' ? 'phone' : `webcam:${deviceId ?? ''}`;
  const [corners, setCornersState] = useState(() => loadCorners('phone'));
  const [cornersFor, setCornersFor] = useState('phone');
  if (cornersFor !== cameraKey) {
    // Another camera: its own corners, if it had any.
    setCornersFor(cameraKey);
    setCornersState(loadCorners(cameraKey));
  }
  const setCorners = useCallback(
    (next: Quad | null) => {
      saveCorners(cameraKey, next);
      setCornersState(next);
    },
    [cameraKey],
  );
  // Not straightened, a camera filming at more than the others get is shrunk for them all the same.
  const { straightener, error: straightenError } = useStraightener(rawTrack, corners, resolution > 1080);
  const track = straightener?.track ?? rawTrack;

  const snapshot = useCallback(
    async (crop: CropRect) => {
      const receiver = receiverRef.current;
      // The phone can take a full-resolution photo; a webcam gives its current frame.
      const capture = async (part: CropRect, exact = false) => {
        if (source === 'phone' && receiver?.isLive) return checkedPhonePicture(receiver, rawTrack, part, exact);
        if (rawTrack) return captureFrame(rawTrack, part);
        throw new Error('The camera is off.');
      };
      if (!straightener || !corners) return capture(crop);
      // Straightened: take the picture of what's behind the crop in the camera, then straighten that too.
      const h = squareToQuad(corners);
      const region = cropInCamera(crop, h);
      const picture = await dataUrlToRgba(await capture(region, true));
      const aspect = (crop.width * straightener.width) / (crop.height * straightener.height);
      const long = Math.min(1800, Math.max(picture.width, picture.height));
      const [width, height] = aspect >= 1 ? [long, Math.round(long / aspect)] : [Math.round(long * aspect), long];
      return rgbaToDataUrl(warpCrop(picture, region, crop, h, width, height));
    },
    [source, rawTrack, straightener, corners],
  );

  return {
    snapshot,
    source,
    track,
    rawTrack,
    straighten: { supported: Straightener.supported(), corners, error: straightenError, set: setCorners },
    phone: { state: phoneState, urls },
    webcam: { devices, deviceId, error: webcamError },
    resolution,
    setResolution,
    sent,
    setSent,
    selectPhone,
    selectWebcam,
    refreshDevices,
  };
}

/** The margin the phone adds around the part asked for, when it needn't be exact (see PhoneReceiver). */
const PHONE_MARGIN = 0.2;
/** A phone picture at least this much like its part of the video is of that part, the right way up. */
const LIKE_THE_VIDEO = 0.5;

/**
 * The phone's sharp picture of part of its view, checked against that part of its video, which is the right
 * way up. Held sideways, some phones' pictures come out turned and of the wrong part (seen with an iPhone):
 * then the picture is taken from the video instead, less sharp but of the right part.
 */
async function checkedPhonePicture(
  receiver: PhoneReceiver,
  video: MediaStreamTrack | null,
  part: CropRect,
  exact: boolean,
): Promise<string> {
  const picture = await receiver.requestSnapshot(part, { exact });
  if (!video) return picture;
  try {
    const [taken, seen] = await Promise.all([
      dataUrlToRgba(picture),
      captureFrame(video, exact ? part : widen(part, PHONE_MARGIN)).then(dataUrlToRgba),
    ]);
    if (likeness(taken, seen) >= LIKE_THE_VIDEO) return picture;
  } catch {
    // Couldn't check: the phone's picture it is.
    return picture;
  }
  console.warn("[camera] the phone's picture doesn't look like its video; taking it from the video");
  return captureFrame(video, part);
}

/**
 * The camera straightened by the corners, while there are corners and a camera; or why it can't be (the
 * graphics card won't do it). Without corners but with `shrink`, the whole picture, at most as large as the
 * others get.
 */
function useStraightener(
  raw: MediaStreamTrack | null,
  corners: Quad | null,
  shrink: boolean,
): { straightener: Straightener | null; error: string | null } {
  const [straightener, setStraightener] = useState<Straightener | null>(null);
  const [error, setError] = useState<{ for: Quad; message: string } | null>(null);
  useEffect(() => {
    if (!raw || !(corners || shrink) || !Straightener.supported()) return;
    let made: Straightener;
    try {
      made = corners
        ? new Straightener(raw, corners, (width, height) => straightenedSize(corners, width, height))
        : new Straightener(raw, WHOLE_PICTURE, (width, height) => shrunkSize(width, height));
    } catch (failure) {
      console.warn('[camera] could not straighten', failure);
      if (corners) queueMicrotask(() => setError({ for: corners, message: errorMessage(failure) }));
      return;
    }
    // A new object for each straightener: the state changes only when one starts or stops.
    queueMicrotask(() => setStraightener(made));
    return () => {
      made.stop();
      setStraightener((current) => (current === made ? null : current));
    };
  }, [raw, corners, shrink]);
  return {
    straightener: straightener && raw && (corners || shrink) ? straightener : null,
    error: error && error.for === corners ? error.message : null,
  };
}

const RESOLUTION_KEY = 'cb.resolution';
const SENT_KEY = 'cb.sentHeight';

/** The sent quality picked before: 1080p at first. */
function loadSent(): SentHeight {
  const saved = Number(localStorage.getItem(SENT_KEY));
  return (SENT_HEIGHTS as readonly number[]).includes(saved) ? (saved as SentHeight) : 1080;
}

/** The resolution picked before; 4K only where it can be shrunk for the others (see useStraightener). */
function loadResolution(): CameraHeight {
  const saved = Number(localStorage.getItem(RESOLUTION_KEY));
  return isCameraHeight(saved) && (saved <= 1080 || Straightener.supported()) ? saved : 1080;
}

const CORNERS_KEY = 'cb.corners.';

function loadCorners(camera: string): Quad | null {
  try {
    const raw = localStorage.getItem(CORNERS_KEY + camera);
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (
      Array.isArray(value) &&
      value.length === 4 &&
      value.every((p: { x?: unknown; y?: unknown } | null) => typeof p?.x === 'number' && typeof p.y === 'number')
    ) {
      return value as unknown as Quad;
    }
  } catch {
    // Unreadable: as if there were none.
  }
  return null;
}

function saveCorners(camera: string, corners: Quad | null): void {
  if (corners) localStorage.setItem(CORNERS_KEY + camera, JSON.stringify(corners));
  else localStorage.removeItem(CORNERS_KEY + camera);
}
