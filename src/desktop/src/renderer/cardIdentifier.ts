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

/** Card art pictures from Scryfall, kept for the session: the usual ones, and other printings' when asked. */
export const artLibrary = new ScryfallArtLibrary({ artworks: (card) => artworksOf(card.id) });

/** Asks for many cards' artworks at once (a deck's worth), a moment after the first is wanted. */
const wanted = new Map<string, ((images: readonly string[]) => void)[]>();
let asking: ReturnType<typeof setTimeout> | null = null;

function artworksOf(id: string): Promise<readonly string[]> {
  return new Promise((resolve) => {
    wanted.set(id, [...(wanted.get(id) ?? []), resolve]);
    asking ??= setTimeout(() => {
      asking = null;
      const batch = new Map(wanted);
      wanted.clear();
      api.cards.artworks([...batch.keys()]).then(
        (artworks) => batch.forEach((resolvers, cardId) => resolvers.forEach((r) => r(artworks[cardId] ?? []))),
        () => batch.forEach((resolvers) => resolvers.forEach((r) => r([]))),
      );
    }, 50);
  });
}

/** Works out which card is in a close-up. One for the whole app: its text reader takes a moment to start. */
export const cardIdentifier = new CardIdentifier(reader, { closest: (texts) => api.cards.closest(texts) }, artLibrary);

/** Gets the text reader going, so the first close-up isn't kept waiting for it. */
export function warmUpCardIdentifier(): void {
  reader.warmUp();
}
