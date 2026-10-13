import { CardIdentifier } from '@commander-brawl/application';
import { ScryfallArtLibrary, TesseractReader } from '@commander-brawl/infrastructure/browser';
import { api } from './api';
// Shipped with the app, so reading cards works offline. The language file keeps its name (see vite.config.ts).
import languageUrl from '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz?url';
import coreUrl from 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js?url';
import workerUrl from 'tesseract.js/dist/worker.min.js?url';

const reader = new TesseractReader({
  workerUrl,
  coreUrl,
  languageFolderUrl: languageUrl.slice(0, languageUrl.lastIndexOf('/') + 1),
});

/** Card art pictures from Scryfall, kept for the session. */
export const artLibrary = new ScryfallArtLibrary();

/** Works out which card is in a close-up. One for the whole app: its text reader takes a moment to start. */
export const cardIdentifier = new CardIdentifier(reader, { closest: (texts) => api.cards.closest(texts) }, artLibrary);

/** Gets the text reader going, so the first close-up isn't kept waiting for it. */
export function warmUpCardIdentifier(): void {
  reader.warmUp();
}
