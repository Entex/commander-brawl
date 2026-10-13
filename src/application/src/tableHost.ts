import {
  InvalidPlayerNameError,
  MAX_SPECTATORS,
  Table,
  TableFullError,
  normalizePlayerName,
  type Player,
  type Spectator,
} from '@commander-brawl/domain';
import type { Timers } from './ports';

export interface TableHostOptions {
  readonly secret: string;
  /** How long a player who lost their connection keeps their seat. */
  readonly reconnectGraceMs: number;
  readonly timers: Timers;
  /** Returns a new unguessable id. Used for player ids and resume tokens. */
  readonly createId: () => string;
}

export interface TableHostListener {
  memberJoined(member: Player): void;
  memberLeft(member: Player): void;
  spectatorJoined?(spectator: Spectator): void;
  spectatorLeft?(spectator: Spectator): void;
}

export interface JoinRequest {
  readonly secret: string;
  readonly name: string;
  readonly resumeToken?: string | undefined;
}

/** A seated player as the host saves them, so they can reclaim their seat after the host's app restarts. */
export interface SavedMember {
  readonly player: Player;
  readonly resumeToken: string;
}

export type JoinRejection = 'bad-secret' | 'table-full' | 'bad-name' | 'too-many-spectators';

export type JoinResult =
  | {
      readonly ok: true;
      readonly member: Player;
      readonly members: readonly Player[];
      readonly spectators: readonly Spectator[];
      /** Lets the player reclaim their seat after a dropped connection. */
      readonly resumeToken: string;
      readonly resumed: boolean;
    }
  | { readonly ok: false; readonly reason: JoinRejection };

export type WatchResult =
  | {
      readonly ok: true;
      readonly spectator: Spectator;
      readonly members: readonly Player[];
      readonly spectators: readonly Spectator[];
      /** Lets them come back after a dropped connection, as the same spectator. */
      readonly resumeToken: string;
      readonly resumed: boolean;
    }
  | { readonly ok: false; readonly reason: JoinRejection };

/** Decides who sits at the host's table. Transport-agnostic: the server calls it as connections come and go. */
export class TableHost {
  private readonly table = new Table();
  private readonly memberByToken = new Map<string, string>();
  private readonly tokenByMember = new Map<string, string>();
  private readonly pendingRemovals = new Map<string, () => void>();
  private readonly listeners = new Set<TableHostListener>();
  private readonly watching = new Map<string, Spectator>();

  constructor(private readonly options: TableHostOptions) {}

  get members(): readonly Player[] {
    return this.table.all;
  }

  get spectators(): readonly Spectator[] {
    return [...this.watching.values()];
  }

  /** Lets someone watch the table: no seat, nothing to change. Spectators aren't kept across a host restart. */
  watch(request: JoinRequest): WatchResult {
    if (!constantTimeEquals(request.secret, this.options.secret)) {
      return { ok: false, reason: 'bad-secret' };
    }
    const resumedId = request.resumeToken ? this.memberByToken.get(request.resumeToken) : undefined;
    const resumed = resumedId === undefined ? undefined : this.watching.get(resumedId);
    if (resumed) {
      this.pendingRemovals.get(resumed.id)?.();
      this.pendingRemovals.delete(resumed.id);
      return { ok: true, spectator: resumed, ...this.everyone(), resumeToken: request.resumeToken!, resumed: true };
    }
    if (this.watching.size >= MAX_SPECTATORS) return { ok: false, reason: 'too-many-spectators' };
    let name: string;
    try {
      name = normalizePlayerName(request.name);
    } catch {
      return { ok: false, reason: 'bad-name' };
    }
    const spectator: Spectator = { id: this.options.createId(), name };
    this.watching.set(spectator.id, spectator);
    const resumeToken = this.options.createId();
    this.memberByToken.set(resumeToken, spectator.id);
    this.tokenByMember.set(spectator.id, resumeToken);
    for (const listener of this.listeners) listener.spectatorJoined?.(spectator);
    return { ok: true, spectator, ...this.everyone(), resumeToken, resumed: false };
  }

  private everyone(): { members: readonly Player[]; spectators: readonly Spectator[] } {
    return { members: this.table.all, spectators: this.spectators };
  }

  savedMembers(): SavedMember[] {
    return this.table.all.map((player) => ({ player, resumeToken: this.tokenByMember.get(player.id)! }));
  }

  /**
   * Brings back the players from before the host's app restarted. Their apps reconnect with their
   * resume tokens and get their own seats back; anyone who doesn't come back within graceMs is let go.
   */
  restore(members: readonly SavedMember[], graceMs: number): void {
    for (const member of members) {
      const player = this.table.seatAt(member.player);
      this.memberByToken.set(member.resumeToken, player.id);
      this.tokenByMember.set(player.id, member.resumeToken);
      this.scheduleRemoval(player.id, graceMs);
    }
  }

  addListener(listener: TableHostListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  join(request: JoinRequest): JoinResult {
    if (!constantTimeEquals(request.secret, this.options.secret)) {
      return { ok: false, reason: 'bad-secret' };
    }

    const resumed = this.tryResume(request.resumeToken);
    if (resumed) {
      return resumed;
    }

    let member: Player;
    try {
      member = this.table.seat(this.options.createId(), request.name);
    } catch (error) {
      if (error instanceof TableFullError) return { ok: false, reason: 'table-full' };
      if (error instanceof InvalidPlayerNameError) return { ok: false, reason: 'bad-name' };
      throw error;
    }

    const resumeToken = this.options.createId();
    this.memberByToken.set(resumeToken, member.id);
    this.tokenByMember.set(member.id, resumeToken);
    for (const listener of this.listeners) listener.memberJoined(member);
    return { ok: true, member, ...this.everyone(), resumeToken, resumed: false };
  }

  /** The member's connection dropped. They keep their seat (or their place watching) for the grace period. */
  connectionLost(memberId: string): void {
    if ((!this.table.get(memberId) && !this.watching.has(memberId)) || this.pendingRemovals.has(memberId)) {
      return;
    }
    this.scheduleRemoval(memberId, this.options.reconnectGraceMs);
  }

  private scheduleRemoval(memberId: string, ms: number): void {
    const cancel = this.options.timers.setTimeout(() => {
      this.pendingRemovals.delete(memberId);
      this.remove(memberId);
    }, ms);
    this.pendingRemovals.set(memberId, cancel);
  }

  /** The member left on purpose. */
  leave(memberId: string): void {
    this.remove(memberId);
  }

  private tryResume(resumeToken: string | undefined): JoinResult | undefined {
    if (!resumeToken) {
      return undefined;
    }
    const memberId = this.memberByToken.get(resumeToken);
    const member = memberId === undefined ? undefined : this.table.get(memberId);
    if (!member) {
      return undefined;
    }
    this.pendingRemovals.get(member.id)?.();
    this.pendingRemovals.delete(member.id);
    return { ok: true, member, ...this.everyone(), resumeToken, resumed: true };
  }

  private remove(memberId: string): void {
    this.pendingRemovals.get(memberId)?.();
    this.pendingRemovals.delete(memberId);
    const spectator = this.watching.get(memberId);
    if (spectator) {
      this.watching.delete(memberId);
      const token = this.tokenByMember.get(memberId);
      if (token !== undefined) this.memberByToken.delete(token);
      this.tokenByMember.delete(memberId);
      for (const listener of this.listeners) listener.spectatorLeft?.(spectator);
      return;
    }
    const member = this.table.unseat(memberId);
    const token = this.tokenByMember.get(memberId);
    if (token !== undefined) {
      this.memberByToken.delete(token);
      this.tokenByMember.delete(memberId);
    }
    if (member) {
      for (const listener of this.listeners) listener.memberLeft(member);
    }
  }
}

function constantTimeEquals(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}
