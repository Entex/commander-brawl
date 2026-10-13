import { lastSeconds, muxWebm, type EncodedFrame } from './webm';

export interface ClipRecorderOptions {
  readonly width: number;
  readonly height: number;
  /** Draws what's recorded, once per frame. */
  readonly draw: (context: OffscreenCanvasRenderingContext2D, width: number, height: number) => void;
  readonly fps?: number;
  /** How much a clip holds. */
  readonly seconds?: number;
  readonly bitrate?: number;
}

/** A key frame this often: a clip starts at one, so this is how much longer than asked a clip can be. */
const KEY_FRAME_EVERY_US = 2_000_000;

/** Codecs to try, best first: what the encoder calls it, and what WebM calls it. */
const CODECS = [
  { encoder: 'vp09.00.10.08', webm: 'V_VP9' },
  { encoder: 'vp8', webm: 'V_VP8' },
];

/**
 * Keeps the last half minute (or so) of something drawn, ready to save as a video: frames are drawn, encoded
 * and kept in memory as they go (a few megabytes), older ones dropped. Costs some CPU while it runs.
 */
export class ClipRecorder {
  private frames: EncodedFrame[] = [];
  private readonly canvas: OffscreenCanvas;
  private readonly context: OffscreenCanvasRenderingContext2D;
  private readonly timer: ReturnType<typeof setInterval>;
  private readonly startedAt = performance.now();
  private lastKey = -Infinity;
  private failed: Error | null = null;

  static supported(): boolean {
    return 'VideoEncoder' in globalThis && 'OffscreenCanvas' in globalThis;
  }

  static async start(options: ClipRecorderOptions): Promise<ClipRecorder> {
    const bitrate = options.bitrate ?? 2_500_000;
    const framerate = options.fps ?? 30;
    for (const codec of CODECS) {
      const config: VideoEncoderConfig = {
        codec: codec.encoder,
        width: options.width,
        height: options.height,
        bitrate,
        framerate,
        latencyMode: 'realtime',
      };
      const { supported } = await VideoEncoder.isConfigSupported(config);
      if (supported) return new ClipRecorder(options, config, codec.webm);
    }
    throw new Error('This computer can’t record video (no VP9 or VP8 encoder).');
  }

  private readonly encoder: VideoEncoder;

  private constructor(
    private readonly options: ClipRecorderOptions,
    config: VideoEncoderConfig,
    private readonly codec: string,
  ) {
    this.canvas = new OffscreenCanvas(options.width, options.height);
    this.context = this.canvas.getContext('2d')!;
    this.encoder = new VideoEncoder({
      output: (chunk) => {
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        this.frames.push({ data, timestamp: chunk.timestamp, key: chunk.type === 'key' });
        // Keep what a clip needs, and a key frame's worth more.
        const keep = (this.options.seconds ?? 30) + KEY_FRAME_EVERY_US / 1_000_000;
        if (this.frames.length % 30 === 0) this.frames = lastSeconds(this.frames, keep);
      },
      error: (error) => {
        this.failed = error instanceof Error ? error : new Error(String(error));
      },
    });
    this.encoder.configure(config);
    this.timer = setInterval(() => this.frame(), 1000 / (options.fps ?? 30));
  }

  /** The last half minute (or so) as a WebM video. */
  async save(): Promise<Uint8Array<ArrayBuffer>> {
    if (this.failed) throw this.failed;
    await this.encoder.flush();
    const frames = lastSeconds(this.frames, this.options.seconds ?? 30);
    if (frames.length === 0) throw new Error('Nothing recorded yet.');
    return muxWebm(frames, { width: this.options.width, height: this.options.height, codec: this.codec });
  }

  stop(): void {
    clearInterval(this.timer);
    if (this.encoder.state !== 'closed') this.encoder.close();
    this.frames = [];
  }

  private frame(): void {
    // Falling behind (a busy computer): skip a frame rather than pile them up.
    if (this.failed || this.encoder.state !== 'configured' || this.encoder.encodeQueueSize > 2) return;
    this.options.draw(this.context, this.options.width, this.options.height);
    const timestamp = Math.round((performance.now() - this.startedAt) * 1000);
    const frame = new VideoFrame(this.canvas, { timestamp });
    const key = timestamp - this.lastKey >= KEY_FRAME_EVERY_US;
    if (key) this.lastKey = timestamp;
    try {
      this.encoder.encode(frame, { keyFrame: key });
    } finally {
      frame.close();
    }
  }
}
