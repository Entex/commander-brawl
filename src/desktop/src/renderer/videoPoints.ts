import {
  pictureToScreen,
  screenToPicture,
  type PicturePoint,
  type VideoFit,
} from '@commander-brawl/infrastructure/browser';

/** How the picture fits a seat's video element right now. The element says how it's turned (data-rotation). */
export function fitOf(video: HTMLVideoElement, box: DOMRect): VideoFit {
  return {
    videoWidth: video.videoWidth,
    videoHeight: video.videoHeight,
    elementWidth: box.width,
    elementHeight: box.height,
    rotation: video.dataset.rotation === '180' ? 180 : 0,
  };
}

/** Where a point on screen (as in a mouse event) is on the video's picture. Null off the picture. */
export function pictureAt(video: HTMLVideoElement, clientX: number, clientY: number): PicturePoint | null {
  const box = video.getBoundingClientRect();
  return screenToPicture(fitOf(video, box), clientX - box.left, clientY - box.top);
}

/** The point of the video's picture nearest a point on screen: on it, or at its edge. Null before it has a picture. */
export function pictureNear(video: HTMLVideoElement, clientX: number, clientY: number): PicturePoint | null {
  const box = video.getBoundingClientRect();
  const fit = fitOf(video, box);
  const a = pictureToScreen(fit, { x: 0, y: 0 });
  const b = pictureToScreen(fit, { x: 1, y: 1 });
  if (!a || !b) return null;
  // Just inside the picture's edge, so the point is on it.
  const x = Math.min(Math.max(clientX - box.left, Math.min(a.x, b.x) + 0.5), Math.max(a.x, b.x) - 0.5);
  const y = Math.min(Math.max(clientY - box.top, Math.min(a.y, b.y) + 0.5), Math.max(a.y, b.y) - 0.5);
  return screenToPicture(fit, x, y);
}

/** Where a point of the video's picture is on screen, relative to `origin` (a box on screen). */
export function screenAt(
  video: HTMLVideoElement,
  point: PicturePoint,
  origin: DOMRect,
): { x: number; y: number } | null {
  const box = video.getBoundingClientRect();
  const at = pictureToScreen(fitOf(video, box), point);
  return at && { x: box.left - origin.left + at.x, y: box.top - origin.top + at.y };
}
