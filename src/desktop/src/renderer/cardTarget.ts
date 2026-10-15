import { cardSizeOf, guessCardCrop, locateCardAt, type CropRect, type Quad } from '@commander-brawl/application';
import { videoFrameToRgba } from '@commander-brawl/infrastructure/browser';
import { pictureAt } from './videoPoints';

/** What a click on a player's video picked out. As fractions of their camera picture. */
export interface CardTarget {
  /** The part of their camera picture to ask for. */
  readonly crop: CropRect;
  /** The card's outline, or null if none stood out where the click was (then `crop` is a guess). */
  readonly outline: Quad | null;
}

/** Enough of the video's picture to find a card's outline in. */
const FRAME_SIZE = 960;

/**
 * The card under a click on a seat's video (a point on screen), found in the picture the video is showing.
 * Null for a click beside the picture (the bars around it).
 */
export function cardTargetAt(video: HTMLVideoElement, clientX: number, clientY: number): CardTarget | null {
  const point = pictureAt(video, clientX, clientY);
  if (!point) return null;
  const frame = videoFrameToRgba(video, FRAME_SIZE);
  const found = frame && locateCardAt(frame, point);
  const seat = video.dataset.seat ?? '';
  if (found) {
    cardSizes.set(seat, cardSizeOf(found));
    return found;
  }
  // No outline: about as big as the last card found on this video.
  const aspect = video.videoWidth > 0 && video.videoHeight > 0 ? video.videoWidth / video.videoHeight : undefined;
  return { crop: guessCardCrop(point, cardSizes.get(seat), aspect), outline: null };
}

/** How big the last card found on each seat's video was: cards on one table are about the same size. */
const cardSizes = new Map<string, { readonly width: number; readonly height: number }>();
