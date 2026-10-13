import { Snapshots, type CropRect } from '@commander-brawl/application';
import type { Card, DeckList } from '@commander-brawl/domain';
import { dataUrlToRgba } from '@commander-brawl/infrastructure/browser';
import { useCallback, useEffect, useRef, useState } from 'react';
import { IpcTableSignaling, api } from './api';
import { artLibrary, cardIdentifier, warmUpCardIdentifier } from './cardIdentifier';
import type { SnapshotState } from './components/SnapshotView';
import type { CameraState } from './useCamera';

export interface CloseUps {
  /** The close-up being shown, if any. */
  readonly closeUp: SnapshotState | null;
  /**
   * Asks a player's camera for a sharp picture of part of their table, then works out which card it is,
   * comparing with their deck if they're playing one.
   */
  look(memberId: string, from: string, crop: CropRect, rotation: 0 | 180, deck: DeckList | null): void;
  close(): void;
}

export function useCloseUps(camera: CameraState): CloseUps {
  const requestSnapshot = useSnapshots(camera);
  const [closeUp, setCloseUp] = useState<SnapshotState | null>(null);
  const lastLook = useRef(0);

  const look = useCallback(
    (memberId: string, from: string, crop: CropRect, rotation: 0 | 180, deck: DeckList | null) => {
      const request = { id: ++lastLook.current, from, rotation };
      // Only the newest close-up's results are shown, and none once it's closed.
      const update = (change: (current: SnapshotState) => SnapshotState) =>
        setCloseUp((current) => (current?.id === request.id ? change(current) : current));
      setCloseUp({ ...request, status: 'loading' });
      warmUpCardIdentifier();
      // The deck's artwork downloads while the picture is on its way.
      const likely = deck ? deckCards(deck) : Promise.resolve([]);

      void (async () => {
        let image: string;
        try {
          image = await requestSnapshot(memberId, crop);
        } catch (error) {
          update(() => ({ ...request, status: 'failed', message: (error as Error).message }));
          return;
        }
        update(() => ({ ...request, status: 'ready', image, identification: { status: 'working' } }));
        try {
          const result = await cardIdentifier.identify(await dataUrlToRgba(image), { likely: await likely, rotation });
          update((s) =>
            s.status === 'ready' ? { ...s, identification: { status: 'done', guesses: result.guesses } } : s,
          );
        } catch (error) {
          console.warn('[cards] could not work out which card this is', error);
          update((s) => (s.status === 'ready' ? { ...s, identification: { status: 'done', guesses: [] } } : s));
        }
      })();
    },
    [requestSnapshot],
  );
  const close = useCallback(() => setCloseUp(null), []);
  return { closeUp, look, close };
}

/** The deck's cards, with their artwork starting to load. */
async function deckCards(deck: DeckList): Promise<Card[]> {
  try {
    const found = await api.cards.byIds([...deck.commanders, ...deck.cards].map((card) => card.id));
    const cards = found.filter((card): card is Card => card !== null);
    for (const card of cards) void artLibrary.print(card);
    return cards;
  } catch {
    return [];
  }
}

/**
 * Sharp pictures of cards on other players' tables, and answering their requests for pictures of ours.
 * Lives as long as the table screen. Returns how to ask a player for a picture.
 */
function useSnapshots(camera: CameraState): (memberId: string, crop: CropRect) => Promise<string> {
  const cameraRef = useRef(camera);
  const snapshotsRef = useRef<Snapshots | null>(null);
  useEffect(() => {
    cameraRef.current = camera;
  }, [camera]);
  useEffect(() => {
    const snapshots = new Snapshots(
      new IpcTableSignaling(),
      { capture: (crop) => cameraRef.current.snapshot(crop) },
      {
        timers: {
          setTimeout: (callback, ms) => {
            const handle = window.setTimeout(callback, ms);
            return () => window.clearTimeout(handle);
          },
          now: () => Date.now(),
        },
        createId: () => crypto.randomUUID(),
      },
    );
    snapshots.start();
    snapshotsRef.current = snapshots;
    return () => {
      snapshots.dispose();
      snapshotsRef.current = null;
    };
  }, []);
  return useCallback(
    (memberId: string, crop: CropRect) =>
      snapshotsRef.current?.request(memberId, crop) ?? Promise.reject(new Error('Not at a table.')),
    [],
  );
}
