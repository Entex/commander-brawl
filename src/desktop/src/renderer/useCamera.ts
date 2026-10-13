import {
  captureFrame,
  dataUrlToRgba,
  listCameras,
  openCamera,
  PhoneReceiver,
  rgbaToDataUrl,
  Straightener,
  type CameraDevice,
  type PhoneCameraState,
} from '@commander-brawl/infrastructure/browser';
import {
  cropInCamera,
  squareToQuad,
  straightenedSize,
  warpCrop,
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
        const track = await openCamera(id || undefined);
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
    [refreshDevices, stopWebcam],
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
  const straightener = useStraightener(rawTrack, corners);
  const track = straightener?.track ?? rawTrack;

  const snapshot = useCallback(
    async (crop: CropRect) => {
      const receiver = receiverRef.current;
      // The phone can take a full-resolution photo; a webcam gives its current frame.
      const capture = (part: CropRect, exact = false) => {
        if (source === 'phone' && receiver?.isLive) return receiver.requestSnapshot(part, { exact });
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
    straighten: { supported: Straightener.supported(), corners, set: setCorners },
    phone: { state: phoneState, urls },
    webcam: { devices, deviceId, error: webcamError },
    selectPhone,
    selectWebcam,
    refreshDevices,
  };
}

/** The camera straightened by the corners, while there are corners and a camera. */
function useStraightener(raw: MediaStreamTrack | null, corners: Quad | null): Straightener | null {
  const [straightener, setStraightener] = useState<Straightener | null>(null);
  const size = raw && corners ? sizeFor(raw, corners) : null;
  const width = size?.width;
  const height = size?.height;
  useEffect(() => {
    if (!raw || !corners || !width || !height || !Straightener.supported()) return;
    let made: Straightener;
    try {
      made = new Straightener(raw, corners, width, height);
    } catch (error) {
      console.warn('[camera] could not straighten', error);
      return;
    }
    // A new object for each straightener: the state changes only when one starts or stops.
    queueMicrotask(() => setStraightener(made));
    return () => {
      made.stop();
      setStraightener((current) => (current === made ? null : current));
    };
  }, [raw, corners, width, height]);
  return straightener && raw && corners ? straightener : null;
}

function sizeFor(track: MediaStreamTrack, corners: Quad): { width: number; height: number } {
  const { width = 1280, height = 720 } = track.getSettings();
  return straightenedSize(corners, width, height);
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
