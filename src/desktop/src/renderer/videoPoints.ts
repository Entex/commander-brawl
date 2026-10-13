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
