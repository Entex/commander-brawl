export const MAX_SEATS = 4;
export const MAX_NAME_LENGTH = 24;

export type SeatIndex = 0 | 1 | 2 | 3;

export interface Player {
  readonly id: string;
  readonly name: string;
  readonly seat: SeatIndex;
}

/** Someone watching the table: they see everything, take no seat, and change nothing. */
export interface Spectator {
  readonly id: string;
  readonly name: string;
}

export const MAX_SPECTATORS = 8;

export class TableFullError extends Error {
  constructor() {
    super(`The table already has ${MAX_SEATS} players.`);
    this.name = 'TableFullError';
  }
}

export class InvalidPlayerNameError extends Error {
  constructor(name: string) {
    super(`"${name}" is not a valid player name.`);
    this.name = 'InvalidPlayerNameError';
  }
}

/** Trims and validates a display name. Throws InvalidPlayerNameError if it can't be used. */
export function normalizePlayerName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  if (trimmed.length === 0 || trimmed.length > MAX_NAME_LENGTH) {
    throw new InvalidPlayerNameError(name);
  }
  return trimmed;
}

/** The seats at a table. Players get the lowest free seat and keep it until they leave. */
export class Table {
  private readonly players = new Map<string, Player>();

  get all(): Player[] {
    return [...this.players.values()].sort((a, b) => a.seat - b.seat);
  }

  get isFull(): boolean {
    return this.players.size >= MAX_SEATS;
  }

  get(id: string): Player | undefined {
    return this.players.get(id);
  }

  seat(id: string, name: string): Player {
    const existing = this.players.get(id);
    if (existing) {
      return existing;
    }
    const seat = this.lowestFreeSeat();
    if (seat === undefined) {
      throw new TableFullError();
    }
    const player: Player = { id, name: normalizePlayerName(name), seat };
    this.players.set(id, player);
    return player;
  }

  /** Puts a known player back in their own seat, e.g. after the host's app restarted. */
  seatAt(player: Player): Player {
    const taken = [...this.players.values()].some((p) => p.seat === player.seat && p.id !== player.id);
    if (taken) throw new Error(`Seat ${player.seat + 1} is already taken.`);
    if (!this.players.has(player.id) && this.isFull) throw new TableFullError();
    const seated: Player = { id: player.id, name: normalizePlayerName(player.name), seat: player.seat };
    this.players.set(player.id, seated);
    return seated;
  }

  unseat(id: string): Player | undefined {
    const player = this.players.get(id);
    this.players.delete(id);
    return player;
  }

  private lowestFreeSeat(): SeatIndex | undefined {
    const taken = new Set([...this.players.values()].map((p) => p.seat));
    for (let seat = 0; seat < MAX_SEATS; seat++) {
      if (!taken.has(seat as SeatIndex)) {
        return seat as SeatIndex;
      }
    }
    return undefined;
  }
}
