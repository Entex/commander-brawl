import type { SignalingEvent } from '@commander-brawl/application';
import type { DesktopToPhone, PhoneToDesktop } from '@commander-brawl/infrastructure/protocol';

/** How friends outside your home can reach the table you host. */
export type Reachability =
  | { readonly kind: 'internet'; readonly address: string; readonly port: number }
  | { readonly kind: 'blocked'; readonly reason: string; readonly port: number };

export interface HostInfo {
  readonly invite: string;
  readonly reachability: Reachability;
}

export interface IceServerConfig {
  readonly urls: string | string[];
  readonly username?: string;
  readonly credential?: string;
}

export interface RendererConfig {
  readonly version: string;
  /** null means "use the defaults"; an empty list means "local network only" (used by tests). */
  readonly iceServers: IceServerConfig[] | null;
}

export type PhoneLinkEvent =
  | { readonly type: 'connected' }
  | { readonly type: 'disconnected' }
  | { readonly type: 'message'; readonly message: PhoneToDesktop };

export interface PhoneLinkInfo {
  /** One link per local network address of this computer; the first is the best guess. */
  readonly urls: readonly string[];
  readonly connected: boolean;
}

/** What the preload script exposes to the UI as `window.brawl`. */
export interface DesktopApi {
  config(): Promise<RendererConfig>;
  table: {
    host(name: string): Promise<HostInfo>;
    join(invite: string, name: string): Promise<void>;
    leave(): Promise<void>;
    send(to: string, data: unknown): void;
    /** Events that describe the current state, for when the UI starts listening late. */
    snapshot(): Promise<SignalingEvent[]>;
    onEvent(listener: (event: SignalingEvent) => void): () => void;
  };
  phone: {
    info(): Promise<PhoneLinkInfo>;
    send(message: DesktopToPhone): void;
    onEvent(listener: (event: PhoneLinkEvent) => void): () => void;
  };
}

export const Channels = {
  config: 'config',
  tableHost: 'table:host',
  tableJoin: 'table:join',
  tableLeave: 'table:leave',
  tableSend: 'table:send',
  tableSnapshot: 'table:snapshot',
  tableEvent: 'table:event',
  phoneInfo: 'phone:info',
  phoneSend: 'phone:send',
  phoneEvent: 'phone:event',
} as const;
