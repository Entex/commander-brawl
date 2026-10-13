import type { JoinRejection } from '@commander-brawl/application';
import { MAX_SEATS, type Player, type SeatIndex } from '@commander-brawl/domain';

/** Bump when the host and players can no longer understand each other. */
export const TABLE_PROTOCOL_VERSION = 1;
export const TABLE_PATH = '/table';

export type TableRejection = JoinRejection | 'bad-version';

export type TableClientMessage =
  | {
      readonly t: 'hello';
      readonly v: number;
      readonly secret: string;
      readonly name: string;
      readonly resumeToken?: string | undefined;
    }
  | { readonly t: 'signal'; readonly to: string; readonly data: unknown }
  | { readonly t: 'bye' };

export type TableServerMessage =
  | {
      readonly t: 'welcome';
      readonly selfId: string;
      readonly resumeToken: string;
      readonly members: readonly Player[];
    }
  | { readonly t: 'member-joined'; readonly member: Player }
  | { readonly t: 'member-left'; readonly memberId: string }
  | { readonly t: 'signal'; readonly from: string; readonly data: unknown }
  | { readonly t: 'rejected'; readonly reason: TableRejection };

/** Close codes the server uses so clients know whether reconnecting makes sense. */
export const TableCloseCode = {
  rejected: 4003,
  replaced: 4001,
  helloTimeout: 4002,
  tableClosed: 4004,
} as const;

export function parseClientMessage(raw: string): TableClientMessage | null {
  const message = parseObject(raw);
  if (!message) return null;
  switch (message.t) {
    case 'hello':
      return typeof message.v === 'number' &&
        isShortString(message.secret) &&
        isShortString(message.name) &&
        (message.resumeToken === undefined || isShortString(message.resumeToken))
        ? { t: 'hello', v: message.v, secret: message.secret, name: message.name, resumeToken: message.resumeToken }
        : null;
    case 'signal':
      return isShortString(message.to) && 'data' in message ? { t: 'signal', to: message.to, data: message.data } : null;
    case 'bye':
      return { t: 'bye' };
    default:
      return null;
  }
}

export function parseServerMessage(raw: string): TableServerMessage | null {
  const message = parseObject(raw);
  if (!message) return null;
  switch (message.t) {
    case 'welcome':
      return isShortString(message.selfId) &&
        isShortString(message.resumeToken) &&
        Array.isArray(message.members) &&
        message.members.every(isPlayer)
        ? { t: 'welcome', selfId: message.selfId, resumeToken: message.resumeToken, members: message.members }
        : null;
    case 'member-joined':
      return isPlayer(message.member) ? { t: 'member-joined', member: message.member } : null;
    case 'member-left':
      return isShortString(message.memberId) ? { t: 'member-left', memberId: message.memberId } : null;
    case 'signal':
      return isShortString(message.from) && 'data' in message
        ? { t: 'signal', from: message.from, data: message.data }
        : null;
    case 'rejected':
      return isRejection(message.reason) ? { t: 'rejected', reason: message.reason } : null;
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

function isShortString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256;
}

function isPlayer(value: unknown): value is Player {
  if (typeof value !== 'object' || value === null) return false;
  const { id, name, seat } = value as Record<string, unknown>;
  return isShortString(id) && isShortString(name) && isSeat(seat);
}

function isSeat(value: unknown): value is SeatIndex {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < MAX_SEATS;
}

function isRejection(value: unknown): value is TableRejection {
  return value === 'bad-secret' || value === 'table-full' || value === 'bad-name' || value === 'bad-version';
}
