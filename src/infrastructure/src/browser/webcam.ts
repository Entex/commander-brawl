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

export async function openCamera(deviceId?: string): Promise<MediaStreamTrack> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 24, max: 30 },
    },
  });
  const track = stream.getVideoTracks()[0];
  if (!track) throw new Error('The camera gave no video.');
  track.contentHint = 'detail';
  return track;
}
