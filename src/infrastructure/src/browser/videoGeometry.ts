/**
 * Where things are on a video element: the camera picture is fitted inside it (bars on two sides when the
 * shapes differ), and the element may be turned around for a player who flipped that video.
 */

export interface VideoFit {
  /** The camera picture's size. */
  readonly videoWidth: number;
  readonly videoHeight: number;
  /** The element's size on screen. */
  readonly elementWidth: number;
  readonly elementHeight: number;
  /** The element is turned this far on screen. */
  readonly rotation: 0 | 180;
}

/** A point as fractions (0 to 1) of the picture's width and height, from its top left. */
export interface PicturePoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Where a point on screen (relative to the element's box) is on the picture. Null on the bars beside the
 * picture, or before the video has a picture.
 */
export function screenToPicture(fit: VideoFit, screenX: number, screenY: number): PicturePoint | null {
  const shown = shownPicture(fit);
  if (!shown) return null;
  // A turned element's own coordinates run the other way.
  const [ex, ey] =
    fit.rotation === 180 ? [fit.elementWidth - screenX, fit.elementHeight - screenY] : [screenX, screenY];
  const x = (ex - shown.left) / shown.width;
  const y = (ey - shown.top) / shown.height;
  return x < 0 || x > 1 || y < 0 || y > 1 ? null : { x, y };
}

/** Where a point of the picture is on screen, relative to the element's box. */
export function pictureToScreen(fit: VideoFit, point: PicturePoint): { x: number; y: number } | null {
  const shown = shownPicture(fit);
  if (!shown) return null;
  const ex = shown.left + point.x * shown.width;
  const ey = shown.top + point.y * shown.height;
  return fit.rotation === 180 ? { x: fit.elementWidth - ex, y: fit.elementHeight - ey } : { x: ex, y: ey };
}

/** The part of the element the picture takes up, in the element's own coordinates. */
function shownPicture(fit: VideoFit) {
  if (!fit.videoWidth || !fit.videoHeight || !fit.elementWidth || !fit.elementHeight) return null;
  const scale = Math.min(fit.elementWidth / fit.videoWidth, fit.elementHeight / fit.videoHeight);
  const width = fit.videoWidth * scale;
  const height = fit.videoHeight * scale;
  return { left: (fit.elementWidth - width) / 2, top: (fit.elementHeight - height) / 2, width, height };
}
