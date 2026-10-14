import type { CameraHeight } from '../protocol';

export interface CameraDevice {
  readonly deviceId: string;
  readonly label: string;
}

/** Cameras plugged into or built into this computer, including phones the OS shares as webcams. */
export async function listCameras(): Promise<CameraDevice[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((device) => device.kind === 'videoinput')
    .map((device, index) => ({ deviceId: device.deviceId, label: device.label || `Camera ${index + 1}` }));
}

/**
 * What to ask a camera for: a picture this high and 16:9 (or the nearest it has), at a frame rate that's plenty
 * for cards on a table.
 */
export function cameraConstraints(height: CameraHeight): MediaTrackConstraints {
  return {
    width: { ideal: Math.round((height * 16) / 9) },
    height: { ideal: height },
    frameRate: { ideal: 24, max: 30 },
  };
}

export async function openCamera(deviceId?: string, height: CameraHeight = 1080): Promise<MediaStreamTrack> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), ...cameraConstraints(height) },
  });
  const track = stream.getVideoTracks()[0];
  if (!track) throw new Error('The camera gave no video.');
  track.contentHint = 'detail';
  return track;
}
