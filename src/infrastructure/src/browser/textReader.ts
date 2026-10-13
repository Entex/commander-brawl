import type { RgbaImage, TextReader } from '@commander-brawl/application';
import type { PSM, Worker } from 'tesseract.js';

/** Where the app keeps Tesseract's files, so reading works offline. */
export interface TesseractFiles {
  /** tesseract.js's worker script (dist/worker.min.js). */
  readonly workerUrl: string;
  /** A tesseract.js-core script with its WebAssembly built in (tesseract-core-simd-lstm.wasm.js). */
  readonly coreUrl: string;
  /** The folder with eng.traineddata.gz in it. */
  readonly languageFolderUrl: string;
}

/** Tesseract's page segmentation modes used here (its PSM values). */
const SINGLE_LINE = '7' as PSM;
const SPARSE_TEXT = '11' as PSM;

/**
 * Reads text with Tesseract, in a web worker. Started on first use (it takes a second or so to load),
 * then kept for the rest of the session. One picture at a time.
 */
export class TesseractReader implements TextReader {
  private worker: Promise<Worker> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly files: TesseractFiles) {}

  /**
   * Both as a single line and as scattered text: on a card's name bar, the frame and artwork around the
   * name throw one or the other off, and which one differs from card to card. And as a single line once more
   * with the contrast stretched, which reads dim, soft pictures that the others don't (and misses some they get).
   */
  readLine(image: RgbaImage): Promise<string[]> {
    return this.run(async (worker) => [
      ...(await recognize(worker, image, SINGLE_LINE)),
      ...(await recognize(worker, image, SPARSE_TEXT)),
      ...(await recognize(worker, { ...image, data: stretched(image) }, SINGLE_LINE)),
    ]);
  }

  readPage(image: RgbaImage): Promise<string[]> {
    return this.run((worker) => recognize(worker, image, SPARSE_TEXT));
  }

  /** Loads Tesseract now, so the first reading doesn't wait for it. */
  warmUp(): void {
    void this.start().catch(() => undefined);
  }

  dispose(): void {
    const worker = this.worker;
    this.worker = null;
    void worker?.then((w) => w.terminate()).catch(() => undefined);
  }

  private run<T>(job: (worker: Worker) => Promise<T>): Promise<T> {
    const result = this.queue.then(async () => job(await this.start()));
    this.queue = result.catch(() => undefined);
    return result;
  }

  private start(): Promise<Worker> {
    this.worker ??= (async () => {
      const { createWorker, OEM } = await import('tesseract.js');
      const absolute = (url: string) => new URL(url, document.baseURI).href;
      return createWorker('eng', OEM.LSTM_ONLY, {
        workerPath: absolute(this.files.workerUrl),
        corePath: absolute(this.files.coreUrl),
        langPath: absolute(this.files.languageFolderUrl).replace(/\/$/, ''),
        workerBlobURL: false,
        cacheMethod: 'none',
        gzip: true,
      });
    })().catch((error: unknown) => {
      this.worker = null;
      throw error;
    });
    return this.worker;
  }
}

async function recognize(worker: Worker, image: RgbaImage, mode: PSM): Promise<string[]> {
  await worker.setParameters({ tessedit_pageseg_mode: mode });
  const canvas = new OffscreenCanvas(image.width, image.height);
  canvas
    .getContext('2d')!
    .putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
  const { data } = await worker.recognize(canvas);
  return data.text.split('\n').filter((line) => line.trim().length > 0);
}

/**
 * The picture in gray, its brightness stretched from darkest to lightest (ignoring the odd speck): dim, soft
 * camera pictures of a name on a colored bar read much better that way.
 */
function stretched(image: RgbaImage): Uint8ClampedArray<ArrayBuffer> {
  const { data } = image;
  const gray = new Float32Array(data.length / 4);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = 0.299 * data[i * 4]! + 0.587 * data[i * 4 + 1]! + 0.114 * data[i * 4 + 2]!;
  }
  const sorted = Float32Array.from(gray).sort();
  const low = sorted[Math.floor(sorted.length * 0.02)] ?? 0;
  const high = sorted[Math.floor(sorted.length * 0.98)] ?? 255;
  const scale = high > low ? 255 / (high - low) : 1;
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < gray.length; i++) {
    const value = (gray[i]! - low) * scale;
    out[i * 4] = value;
    out[i * 4 + 1] = value;
    out[i * 4 + 2] = value;
    out[i * 4 + 3] = 255;
  }
  return out;
}
