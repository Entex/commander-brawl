import {
  listCameras,
  openCamera,
  PhoneReceiver,
  type CameraDevice,
  type PhoneCameraState,
} from '@commander-brawl/infrastructure/browser';
import type { CameraStatus } from '@commander-brawl/application';
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
  /** The camera other players see. */
  readonly track: MediaStreamTrack | null;
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
    const off = api.phone.onEvent((event) => {
      if (event.type === 'message') void receiver.handle(event.message);
      if (event.type === 'disconnected') receiver.phoneDisconnected();
    });
    void api.phone.info().then((info) => setUrls(info.urls));
    return () => {
      off();
      receiver.close();
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

  return {
    source,
    track: source === 'phone' ? phoneTrack : webcamTrack,
    phone: { state: phoneState, urls },
    webcam: { devices, deviceId, error: webcamError },
    selectPhone,
    selectWebcam,
    refreshDevices,
  };
}
