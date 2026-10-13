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

export type PhoneToDesktop =
  | { readonly t: 'offer'; readonly session: number; readonly sdp: string }
  | { readonly t: 'candidate'; readonly session: number; readonly candidate: IceCandidate }
  | { readonly t: 'ping' };

export type DesktopToPhone =
  | { readonly t: 'answer'; readonly session: number; readonly sdp: string }
  | { readonly t: 'candidate'; readonly session: number; readonly candidate: IceCandidate }
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
