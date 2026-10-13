/**
 * Messages between the phone camera page and the player's own desktop app, over the local Wi-Fi.
 * `session` increases every time the phone starts a new video connection, so late messages
 * for an older connection can be ignored.
 */

export const PHONE_LINK_PATH = '/link';

/** The desktop closes the phone's connection with this code when another phone takes over. */
export const PHONE_REPLACED_CLOSE_CODE = 4001;

export interface IceCandidate {
  readonly candidate: string;
  readonly sdpMid: string | null;
  readonly sdpMLineIndex: number | null;
}

/** A part of the camera picture, as fractions of its width and height from the top left. */
export interface PhoneCrop {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type PhoneToDesktop =
  | { readonly t: 'offer'; readonly session: number; readonly sdp: string }
  | { readonly t: 'candidate'; readonly session: number; readonly candidate: IceCandidate }
  | { readonly t: 'snapshot'; readonly id: string; readonly image: string }
  | { readonly t: 'snapshot-failed'; readonly id: string; readonly message: string }
  | { readonly t: 'ping' };

export type DesktopToPhone =
  | { readonly t: 'answer'; readonly session: number; readonly sdp: string }
  | { readonly t: 'candidate'; readonly session: number; readonly candidate: IceCandidate }
  /**
   * Take a sharp picture of this part of the camera view: a little more than that (`margin`, a share of the crop
   * on each side, 0.2 if not given) when the photo may not line up exactly with the video.
   */
  | { readonly t: 'snapshot'; readonly id: string; readonly crop: PhoneCrop; readonly margin?: number }
  | { readonly t: 'pong' };

export function parsePhoneToDesktop(raw: string): PhoneToDesktop | null {
  const message = parseObject(raw);
  if (!message) return null;
  switch (message.t) {
    case 'offer':
      return isSession(message.session) && isSdp(message.sdp)
        ? { t: 'offer', session: message.session, sdp: message.sdp }
        : null;
    case 'candidate':
      return isSession(message.session) && isCandidate(message.candidate)
        ? { t: 'candidate', session: message.session, candidate: message.candidate }
        : null;
    case 'snapshot':
      return isId(message.id) &&
        typeof message.image === 'string' &&
        message.image.startsWith('data:image/') &&
        message.image.length <= MAX_SNAPSHOT_LENGTH
        ? { t: 'snapshot', id: message.id, image: message.image }
        : null;
    case 'snapshot-failed':
      return isId(message.id) && typeof message.message === 'string'
        ? { t: 'snapshot-failed', id: message.id, message: message.message.slice(0, 300) }
        : null;
    case 'ping':
      return { t: 'ping' };
    default:
      return null;
  }
}

export function parseDesktopToPhone(raw: string): DesktopToPhone | null {
  const message = parseObject(raw);
  if (!message) return null;
  switch (message.t) {
    case 'answer':
      return isSession(message.session) && isSdp(message.sdp)
        ? { t: 'answer', session: message.session, sdp: message.sdp }
        : null;
    case 'candidate':
      return isSession(message.session) && isCandidate(message.candidate)
        ? { t: 'candidate', session: message.session, candidate: message.candidate }
        : null;
    case 'snapshot': {
      if (!isId(message.id) || !isCrop(message.crop)) return null;
      const { margin } = message;
      if (margin === undefined) return { t: 'snapshot', id: message.id, crop: message.crop };
      return typeof margin === 'number' && margin >= 0 && margin <= 0.5
        ? { t: 'snapshot', id: message.id, crop: message.crop, margin }
        : null;
    }
    case 'pong':
      return { t: 'pong' };
    default:
      return null;
  }
}

function parseObject(raw: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** A snapshot from the phone as a data URL: a few megabytes at most. */
export const MAX_SNAPSHOT_LENGTH = 8_000_000;

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 64;
}

function isCrop(value: unknown): value is PhoneCrop {
  if (typeof value !== 'object' || value === null) return false;
  const crop = value as Record<string, unknown>;
  return ['x', 'y', 'width', 'height'].every(
    (key) => typeof crop[key] === 'number' && (crop[key] as number) >= 0 && (crop[key] as number) <= 1,
  );
}

function isSession(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isSdp(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length < 32_000;
}

function isCandidate(value: unknown): value is IceCandidate {
  if (typeof value !== 'object' || value === null) return false;
  const { candidate, sdpMid, sdpMLineIndex } = value as Record<string, unknown>;
  return (
    typeof candidate === 'string' &&
    candidate.length < 1024 &&
    (sdpMid === null || typeof sdpMid === 'string') &&
    (sdpMLineIndex === null || typeof sdpMLineIndex === 'number')
  );
}
