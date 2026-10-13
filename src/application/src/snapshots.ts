import type { TableSignaling, Timers, Unsubscribe } from './ports';

/** A part of a camera picture, as fractions of its width and height (0 to 1) from the top left. */
export interface CropRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Takes a sharp picture of part of this player's own camera view. */
export interface SnapshotSource {
  /** A JPEG as a data URL. */
  capture(crop: CropRect): Promise<string>;
}

type SnapshotMessage =
  | { readonly kind: 'request'; readonly id: string; readonly crop: CropRect }
  | { readonly kind: 'result'; readonly id: string; readonly image: string }
  | { readonly kind: 'error'; readonly id: string; readonly message: string };

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

export interface SnapshotsOptions {
  readonly timers: Timers;
  readonly createId: () => string;
  /** How long to wait for the other player's camera. */
  readonly timeoutMs?: number;
}

/** Biggest picture accepted from another player, as a data URL: a few megabytes. */
const MAX_IMAGE_LENGTH = 6_000_000;

/**
 * Sharp pictures of another player's cards. You ask their computer for part of its camera view;
 * it takes the picture (from the phone at full resolution, if it can) and sends just that part back.
 */
export class Snapshots {
  private readonly waiting = new Map<
    string,
    { resolve(image: string): void; reject(error: Error): void; cancelTimeout(): void }
  >();
  private unsubscribe: Unsubscribe | null = null;

  constructor(
    private readonly signaling: TableSignaling,
    private readonly source: SnapshotSource | null,
    private readonly options: SnapshotsOptions,
  ) {}

  start(): void {
    this.unsubscribe ??= this.signaling.subscribe((event) => {
      if (event.type === 'signal') this.handle(event.from, event.data);
    });
  }

  dispose(): void {
    this.unsubscribe?.();
    for (const [id, waiting] of this.waiting) {
      waiting.cancelTimeout();
      waiting.reject(new SnapshotError('Left the table.'));
      this.waiting.delete(id);
    }
  }

  /** Asks another player's computer for a picture of part of their camera view. */
  request(memberId: string, crop: CropRect): Promise<string> {
    const id = this.options.createId();
    return new Promise((resolve, reject) => {
      const cancelTimeout = this.options.timers.setTimeout(() => {
        this.waiting.delete(id);
        reject(new SnapshotError("Their camera didn't answer in time."));
      }, this.options.timeoutMs ?? 15_000);
      this.waiting.set(id, { resolve, reject, cancelTimeout });
      this.send(memberId, { kind: 'request', id, crop: clampCrop(crop) });
    });
  }

  private handle(from: string, data: unknown): void {
    const message = toSnapshotMessage(data);
    if (!message) return;
    if (message.kind === 'request') {
      void this.answer(from, message.id, message.crop);
      return;
    }
    const waiting = this.waiting.get(message.id);
    if (!waiting) return;
    this.waiting.delete(message.id);
    waiting.cancelTimeout();
    if (message.kind === 'result') waiting.resolve(message.image);
    else waiting.reject(new SnapshotError(message.message));
  }

  private async answer(to: string, id: string, crop: CropRect): Promise<void> {
    if (!this.source) {
      this.send(to, { kind: 'error', id, message: "They don't have a camera on." });
      return;
    }
    try {
      this.send(to, { kind: 'result', id, image: await this.source.capture(crop) });
    } catch (error) {
      this.send(to, {
        kind: 'error',
        id,
        message: `Their camera couldn't take the picture: ${(error as Error).message}`,
      });
    }
  }

  private send(to: string, message: SnapshotMessage): void {
    this.signaling.send(to, { snapshot: message });
  }
}

export function clampCrop(crop: CropRect): CropRect {
  const width = clamp(crop.width, 0.02, 1);
  const height = clamp(crop.height, 0.02, 1);
  return { x: clamp(crop.x, 0, 1 - width), y: clamp(crop.y, 0, 1 - height), width, height };
}

function toSnapshotMessage(data: unknown): SnapshotMessage | null {
  if (typeof data !== 'object' || data === null || !('snapshot' in data)) return null;
  const message = data.snapshot as Record<string, unknown> | null;
  if (typeof message !== 'object' || message === null || typeof message.id !== 'string' || message.id.length > 64) {
    return null;
  }
  switch (message.kind) {
    case 'request': {
      const crop = message.crop as Record<string, unknown> | null;
      const numbers =
        crop && ['x', 'y', 'width', 'height'].every((k) => typeof crop[k] === 'number' && Number.isFinite(crop[k]));
      return numbers ? { kind: 'request', id: message.id, crop: crop as unknown as CropRect } : null;
    }
    case 'result':
      return typeof message.image === 'string' &&
        message.image.startsWith('data:image/') &&
        message.image.length <= MAX_IMAGE_LENGTH
        ? { kind: 'result', id: message.id, image: message.image }
        : null;
    case 'error':
      return typeof message.message === 'string'
        ? { kind: 'error', id: message.id, message: message.message.slice(0, 300) }
        : null;
    default:
      return null;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
