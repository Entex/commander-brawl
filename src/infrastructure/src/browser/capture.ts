import type { CropRect, RgbaImage } from '@commander-brawl/application';
import { imageToRgba, videoFrameToRgba } from './pixels';

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
 * middle band; the crop is mapped onto the photo that way, with some margin (a share of the crop on each side)
 * in case a phone does it differently. Falls back to a video frame, which is exactly the crop.
 *
 * A phone held sideways can take the photo the other way up from its video (Chrome on Android does), so the
 * photo is first turned whichever way makes it look like the video's current frame.
 */
export async function capturePhoto(track: MediaStreamTrack, crop: CropRect, margin = 0.2): Promise<string> {
  const capture = imageCapture(track);
  if (!capture) return captureFrame(track, crop);
  let photo: ImageBitmap;
  try {
    photo = await createImageBitmap(await capture.takePhoto());
  } catch {
    return captureFrame(track, crop);
  }
  const video = await frameFromVideo(track);
  try {
    const frame = videoFrameToRgba(video, MATCH_SIZE);
    const turns = frame ? photoTurns(frame, imageToRgba(photo, MATCH_SIZE)) : 0;
    const turnedAspect = turns % 2 === 1 ? photo.height / photo.width : photo.width / photo.height;
    const videoAspect = video.videoWidth / video.videoHeight;
    return cropTurned(photo, widen(videoToPhoto(crop, turnedAspect, videoAspect), margin), turns);
  } finally {
    video.srcObject = null;
  }
}

/** Pictures are shrunk to this to tell which way up a photo is: enough to see what's where. */
const MATCH_SIZE = 96;
/** Spots compared, along each side. */
const MATCH_GRID = 24;
const WHOLE = { x: 0, y: 0, width: 1, height: 1 };

/**
 * How many quarter turns clockwise make a photo the way up its camera's video is: the turn whose middle band
 * (see videoToPhoto) looks most like the video's picture.
 */
export function photoTurns(video: RgbaImage, photo: RgbaImage): number {
  const seen = samples(video, (u, v) => ({ x: u, y: v }));
  let best = 0;
  let bestLikeness = -Infinity;
  for (let turns = 0; turns < 4; turns++) {
    const aspect = turns % 2 === 1 ? photo.height / photo.width : photo.width / photo.height;
    const band = videoToPhoto(WHOLE, aspect, video.width / video.height);
    const likeness = correlation(
      seen,
      samples(photo, (u, v) => unturn(band.x + u * band.width, band.y + v * band.height, turns)),
    );
    if (likeness > bestLikeness) [best, bestLikeness] = [turns, likeness];
  }
  return best;
}

/**
 * How alike two pictures of the same part of a view look, from -1 to 1: their brightness in a coarse grid,
 * correlated. Coarse, so a sharp photo and a compressed video frame of it still look alike.
 */
export function likeness(a: RgbaImage, b: RgbaImage): number {
  return correlation(coarse(a), coarse(b));
}

const LIKENESS_GRID = 12;

function coarse(image: RgbaImage): Float64Array {
  const sums = new Float64Array(LIKENESS_GRID * LIKENESS_GRID);
  const counts = new Float64Array(LIKENESS_GRID * LIKENESS_GRID);
  const { width, height, data } = image;
  for (let y = 0; y < height; y++) {
    const row = Math.floor((y * LIKENESS_GRID) / height) * LIKENESS_GRID;
    for (let x = 0; x < width; x++) {
      const cell = row + Math.floor((x * LIKENESS_GRID) / width);
      const k = (y * width + x) * 4;
      sums[cell]! += 0.299 * data[k]! + 0.587 * data[k + 1]! + 0.114 * data[k + 2]!;
      counts[cell]! += 1;
    }
  }
  return sums.map((sum, cell) => (counts[cell]! > 0 ? sum / counts[cell]! : 0));
}

/** Where a point of the picture turned clockwise this many quarters is in the picture as it is (as fractions). */
function unturn(x: number, y: number, turns: number): { x: number; y: number } {
  switch (turns % 4) {
    case 1:
      return { x: y, y: 1 - x };
    case 2:
      return { x: 1 - x, y: 1 - y };
    case 3:
      return { x: 1 - y, y: x };
    default:
      return { x, y };
  }
}

/** Brightness at a grid of spots; `at` says where each spot (u, v from 0 to 1) is in the picture. */
function samples(image: RgbaImage, at: (u: number, v: number) => { x: number; y: number }): Float64Array {
  const out = new Float64Array(MATCH_GRID * MATCH_GRID);
  for (let j = 0; j < MATCH_GRID; j++) {
    for (let i = 0; i < MATCH_GRID; i++) {
      const p = at((i + 0.5) / MATCH_GRID, (j + 0.5) / MATCH_GRID);
      const x = Math.min(image.width - 1, Math.max(0, Math.floor(p.x * image.width)));
      const y = Math.min(image.height - 1, Math.max(0, Math.floor(p.y * image.height)));
      const k = (y * image.width + x) * 4;
      out[j * MATCH_GRID + i] = 0.299 * image.data[k]! + 0.587 * image.data[k + 1]! + 0.114 * image.data[k + 2]!;
    }
  }
  return out;
}

function correlation(a: Float64Array, b: Float64Array): number {
  const mean = (values: Float64Array) => values.reduce((sum, v) => sum + v, 0) / values.length;
  const [ma, mb] = [mean(a), mean(b)];
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    ab += (a[i]! - ma) * (b[i]! - mb);
    aa += (a[i]! - ma) ** 2;
    bb += (b[i]! - mb) ** 2;
  }
  return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0;
}

/** Part of a picture turned clockwise this many quarters (`crop` is in the turned picture), as a JPEG. */
async function cropTurned(image: ImageBitmap, crop: CropRect, turns: number): Promise<string> {
  if (turns === 0) return cropToJpeg(image, crop);
  const a = unturn(crop.x, crop.y, turns);
  const b = unturn(crop.x + crop.width, crop.y + crop.height, turns);
  const sx = Math.round(Math.min(a.x, b.x) * image.width);
  const sy = Math.round(Math.min(a.y, b.y) * image.height);
  const sw = Math.max(1, Math.round(Math.abs(b.x - a.x) * image.width));
  const sh = Math.max(1, Math.round(Math.abs(b.y - a.y) * image.height));
  const scale = Math.min(1, MAX_SIDE / Math.max(sw, sh));
  const [width, height] = [Math.round(sw * scale), Math.round(sh * scale)];
  const canvas = document.createElement('canvas');
  [canvas.width, canvas.height] = turns % 2 === 1 ? [height, width] : [width, height];
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No canvas to draw on.');
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate((turns * Math.PI) / 2);
  context.drawImage(image, sx, sy, sw, sh, -width / 2, -height / 2, width, height);
  image.close();
  return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
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
