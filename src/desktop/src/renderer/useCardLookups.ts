import { Snapshots, clampCrop, type CardGuess, type CropRect, type Quad } from '@commander-brawl/application';
import type { Card, DeckList, SeatIndex } from '@commander-brawl/domain';
import { dataUrlToRgba, rgbaToDataUrl } from '@commander-brawl/infrastructure/browser';
import { useCallback, useEffect, useRef, useState } from 'react';
import { IpcTableSignaling, api } from './api';
import { artLibrary, cardIdentifier, warmUpCardIdentifier } from './cardIdentifier';
import type { CardTarget } from './cardTarget';
import type { CameraState } from './useCamera';

/** What their camera saw, as a picture to show. */
export interface LookupPicture {
  readonly url: string;
  /** The card cut out and turned upright. Otherwise the part of their camera picture as it came. */
  readonly straight: boolean;
}

/** How far a lookup has got. */
export type LookupStep =
  | { readonly status: 'asking' }
  | { readonly status: 'failed'; readonly message: string }
  | { readonly status: 'reading'; readonly picture: LookupPicture }
  | { readonly status: 'done'; readonly picture: LookupPicture | null; readonly guesses: readonly CardGuess[] };

/**
 * A card in Cards seen: one clicked on a player's video (yours too), and which card it is; or one a player showed
 * everyone, or found on someone's battlefield.
 */
export interface CardLookup {
  readonly id: number;
  /** Whose camera (or, for a card shown or found, whose seat). */
  readonly from: string;
  /** Your own camera, or seat. */
  readonly own: boolean;
  readonly seat: SeatIndex;
  /** How their video is turned on our screen; a picture that isn't straightened is shown the same way. */
  readonly rotation: 0 | 180;
  /** When it was clicked, or came (Date.now()). */
  readonly at: number;
  /** What was clicked on their video. Null for a card shown or found. */
  readonly target: CardTarget | null;
  /** A close-up, a card a player showed (or cast), or a card another player found on a battlefield. */
  readonly source: 'camera' | 'shown' | 'cast' | 'found';
  /** Who showed or found it. Null for a close-up. */
  readonly by: string | null;
  /** Found by another player and not taken into the list yet: a suggestion. */
  readonly suggested: boolean;
  readonly step: LookupStep;
  /** The card the player said it is, overruling the guesses. */
  readonly chosen: Card | null;
  /** On their battlefield, at the spot clicked: the permanent it is there. */
  readonly placed: string | null;
}

/** The card a lookup comes to: the player's pick, or else the best guess. */
export function lookupCard(lookup: CardLookup): Card | null {
  if (lookup.chosen) return lookup.chosen;
  return lookup.step.status === 'done' ? (lookup.step.guesses[0]?.card ?? null) : null;
}

/** A guess this good is very likely right. */
export const LIKELY = 0.6;

/** The card, if it's known for sure: the player's pick, or a guess that's very likely right. */
export function sureCard(lookup: CardLookup): Card | null {
  if (lookup.chosen) return lookup.chosen;
  const best = lookup.step.status === 'done' ? lookup.step.guesses[0] : undefined;
  return best && best.score >= LIKELY ? best.card : null;
}

/** Lookups kept, newest first: the cards seen this session. */
const MAX_LOOKUPS = 30;

export interface CardLookups {
  /** Newest first. */
  readonly lookups: readonly CardLookup[];
  /**
   * Asks a player's camera for a sharp picture of the card (`memberId`, or null for your own camera), then works
   * out which card it is, comparing with their deck if they're playing one.
   */
  look(
    memberId: string | null,
    from: string,
    seat: SeatIndex,
    target: CardTarget,
    rotation: 0 | 180,
    deck: DeckList | null,
  ): void;
  /** The player says which card it is. */
  choose(id: number, card: Card): void;
  /** The card is now on its player's battlefield, as this permanent. */
  markPlaced(id: number, permanentId: string): void;
  /**
   * A card shown everyone, or found by another player (a suggestion). A card shown that's in the list already comes to
   * the top; a find of a card in the list already isn't suggested.
   */
  addKnown(known: KnownCard): void;
  /** A suggestion taken into the list, as the newest. */
  accept(id: number): void;
  /** Takes these out of the list. */
  remove(ids: readonly number[]): void;
}

/** Cards clicked on players' videos, one lookup each, worked on side by side. */
export function useCardLookups(camera: CameraState): CardLookups {
  const takeSnapshot = useSnapshots(camera);
  const [lookups, setLookups] = useState<readonly CardLookup[]>([]);
  const lastId = useRef(0);

  const change = useCallback((id: number, update: (lookup: CardLookup) => CardLookup) => {
    setLookups((current) => current.map((lookup) => (lookup.id === id ? update(lookup) : lookup)));
  }, []);

  const look = useCallback(
    (
      memberId: string | null,
      from: string,
      seat: SeatIndex,
      target: CardTarget,
      rotation: 0 | 180,
      deck: DeckList | null,
    ) => {
      const id = ++lastId.current;
      const lookup: CardLookup = {
        id,
        from,
        own: memberId === null,
        seat,
        rotation,
        at: Date.now(),
        target,
        source: 'camera',
        by: null,
        suggested: false,
        step: { status: 'asking' },
        chosen: null,
        placed: null,
      };
      setLookups((current) => [lookup, ...current].slice(0, MAX_LOOKUPS));
      const step = (next: LookupStep) => change(id, (l) => ({ ...l, step: next }));
      warmUpCardIdentifier();
      // The deck's artwork downloads while the picture is on its way.
      const likely = deck ? deckCards(deck) : Promise.resolve([]);

      void (async () => {
        let image: string;
        try {
          image = await takeSnapshot(memberId, target.crop);
        } catch (error) {
          step({ status: 'failed', message: (error as Error).message });
          return;
        }
        const photo = { url: image, straight: false };
        step({ status: 'reading', picture: photo });
        try {
          const result = await cardIdentifier.identify(await dataUrlToRgba(image), {
            likely: await likely,
            rotation,
            expected: target.outline ? inCrop(target.outline, target.crop) : undefined,
          });
          const picture = result.picture ? { url: await rgbaToDataUrl(result.picture), straight: true } : photo;
          step({ status: 'done', picture, guesses: result.guesses });
        } catch (error) {
          console.warn('[cards] could not work out which card this is', error);
          step({ status: 'done', picture: photo, guesses: [] });
        }
      })();
    },
    [takeSnapshot, change],
  );

  const choose = useCallback((id: number, card: Card) => change(id, (l) => ({ ...l, chosen: card })), [change]);
  const addKnown = useCallback((known: KnownCard) => {
    setLookups((current) => {
      const existing = current.find((l) => lookupCard(l)?.id === known.card.id && l.seat === known.seat);
      if (known.source === 'found') {
        if (current.some((l) => lookupCard(l)?.id === known.card.id)) return current;
      } else if (existing) {
        // Shown again: to the top, as the newest.
        const moved = { ...existing, at: Date.now(), suggested: false, source: known.source, by: known.by };
        return [moved, ...current.filter((l) => l !== existing)];
      }
      const lookup: CardLookup = {
        id: ++lastId.current,
        from: known.from,
        own: known.own,
        seat: known.seat,
        rotation: 0,
        at: Date.now(),
        target: null,
        source: known.source,
        by: known.by,
        suggested: known.source === 'found',
        step: { status: 'done', picture: null, guesses: [] },
        chosen: known.card,
        placed: null,
      };
      return [lookup, ...current].slice(0, MAX_LOOKUPS);
    });
  }, []);
  const accept = useCallback(
    (id: number) =>
      setLookups((current) => {
        const lookup = current.find((l) => l.id === id);
        if (!lookup) return current;
        return [{ ...lookup, suggested: false, at: Date.now() }, ...current.filter((l) => l !== lookup)];
      }),
    [],
  );
  const markPlaced = useCallback(
    (id: number, permanentId: string) => change(id, (l) => ({ ...l, placed: permanentId })),
    [change],
  );
  const remove = useCallback(
    (ids: readonly number[]) => setLookups((current) => current.filter((lookup) => !ids.includes(lookup.id))),
    [],
  );
  return { lookups, look, choose, markPlaced, addKnown, accept, remove };
}

/** A card that came into Cards seen without a close-up. */
export interface KnownCard {
  readonly card: Card;
  /** Whose: the seat of the player who showed it, or of the battlefield it was found on. */
  readonly seat: SeatIndex;
  readonly from: string;
  readonly own: boolean;
  readonly source: 'shown' | 'cast' | 'found';
  readonly by: string;
}

/** Where the outline found in the video is in the picture of the crop, as fractions of that picture. */
function inCrop(outline: Quad, crop: CropRect): Quad {
  return outline.map((corner) => ({
    x: (corner.x - crop.x) / crop.width,
    y: (corner.y - crop.y) / crop.height,
  })) as unknown as Quad;
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
 * Lives as long as the table screen. Returns how to get a picture: from a player (by id), or from your own
 * camera (null), the same way theirs answer.
 */
function useSnapshots(camera: CameraState): (memberId: string | null, crop: CropRect) => Promise<string> {
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
  return useCallback((memberId: string | null, crop: CropRect) => {
    if (memberId === null) return cameraRef.current.snapshot(clampCrop(crop));
    return snapshotsRef.current?.request(memberId, crop) ?? Promise.reject(new Error('Not at a table.'));
  }, []);
}
