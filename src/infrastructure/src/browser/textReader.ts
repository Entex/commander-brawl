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
   * name throw one or the other off, and which one differs from card to card.
   */
  readLine(image: RgbaImage): Promise<string[]> {
    return this.run(async (worker) => [
      ...(await recognize(worker, image, SINGLE_LINE)),
      ...(await recognize(worker, image, SPARSE_TEXT)),
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
