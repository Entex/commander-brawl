import type { CropRect } from '@commander-brawl/application';

/** Long side of a snapshot, at most. Enough to read a card; small enough to send quickly. */
const MAX_SIDE = 1800;
const JPEG_QUALITY = 0.9;

interface ImageCaptureLike {
  takePhoto(): Promise<Blob>;
  grabFrame(): Promise<ImageBitmap>;
}
type ImageCaptureConstructor = new (track: MediaStreamTrack) => ImageCaptureLike;

/** Chrome on Android (and desktop) has ImageCapture; Safari doesn't. */
function imageCapture(track: MediaStreamTrack): ImageCaptureLike | null {
  const Constructor = (globalThis as { ImageCapture?: ImageCaptureConstructor }).ImageCapture;
  return Constructor ? new Constructor(track) : null;
}

/** The current camera frame at the camera's own resolution, without the blur of video compression. */
export async function captureFrame(track: MediaStreamTrack, crop: CropRect): Promise<string> {
  const capture = imageCapture(track);
  if (capture) return cropToJpeg(await capture.grabFrame(), crop);
  const video = await frameFromVideo(track);
  try {
    return await cropToJpeg(video, crop);
  } finally {
    video.srcObject = null;
  }
}

/**
 * A full-resolution photo, where the browser can take one (often 12 MP on a phone, versus about 2 MP
 * for video). The photo usually covers more than the video (4:3 versus 16:9), with the video being its
 * middle band; the crop is mapped onto the photo that way, with some margin in case a phone does it
 * differently. Falls back to a video frame.
 */
export async function capturePhoto(track: MediaStreamTrack, crop: CropRect): Promise<string> {
  const capture = imageCapture(track);
  if (!capture) return captureFrame(track, crop);
  let photo: ImageBitmap;
  try {
    photo = await createImageBitmap(await capture.takePhoto());
  } catch {
    return captureFrame(track, crop);
  }
  const settings = track.getSettings();
  const videoAspect = settings.width && settings.height ? settings.width / settings.height : 16 / 9;
  return cropToJpeg(photo, widen(videoToPhoto(crop, photo.width / photo.height, videoAspect), 0.2));
}

/** Where a part of the video picture is in a photo of a different shape, assuming the video is centered in it. */
export function videoToPhoto(crop: CropRect, photoAspect: number, videoAspect: number): CropRect {
  if (photoAspect < videoAspect) {
    // The photo is taller: the video is a band across its middle.
    const band = photoAspect / videoAspect;
    return { x: crop.x, y: (1 - band) / 2 + crop.y * band, width: crop.width, height: crop.height * band };
  }
  const band = videoAspect / photoAspect;
  return { x: (1 - band) / 2 + crop.x * band, y: crop.y, width: crop.width * band, height: crop.height };
}

/** Grows the crop by a share of its size on every side, staying inside the picture. */
export function widen(crop: CropRect, by: number): CropRect {
  const x = Math.max(0, crop.x - crop.width * by);
  const y = Math.max(0, crop.y - crop.height * by);
  return {
    x,
    y,
    width: Math.min(1, crop.x + crop.width * (1 + by)) - x,
    height: Math.min(1, crop.y + crop.height * (1 + by)) - y,
  };
}

async function cropToJpeg(image: ImageBitmap | HTMLVideoElement, crop: CropRect): Promise<string> {
  const width = image instanceof HTMLVideoElement ? image.videoWidth : image.width;
  const height = image instanceof HTMLVideoElement ? image.videoHeight : image.height;
  const sx = Math.round(crop.x * width);
  const sy = Math.round(crop.y * height);
  const sw = Math.max(1, Math.round(crop.width * width));
  const sh = Math.max(1, Math.round(crop.height * height));
  const scale = Math.min(1, MAX_SIDE / Math.max(sw, sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No canvas to draw on.');
  context.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  if ('close' in image) image.close();
  return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
}

/** For browsers without ImageCapture: play the track in a hidden video and use its current frame. */
async function frameFromVideo(track: MediaStreamTrack): Promise<HTMLVideoElement> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = new MediaStream([track]);
  await video.play();
  if (video.videoWidth === 0) {
    await new Promise((resolve) => video.addEventListener('loadeddata', resolve, { once: true }));
  }
  return video;
}
