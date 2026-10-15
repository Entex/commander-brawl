import type { Card } from '@commander-brawl/domain';
import { useEffect, useState } from 'react';
import type { CardDataStatus } from '../shared/api';
import { api } from './api';

/** Cards already looked up, by name. Commanders don't change often, so this saves asking again. */
const cache = new Map<string, Card | null>();
/** Cards already looked up, by id: the same cards, however they were asked for. */
const byId = new Map<string, Card | null>();

/** A card by its id: known already, or asked for. Null if there's no such card (or no card data). */
export async function cardById(id: string): Promise<Card | null> {
  if (byId.has(id)) return byId.get(id) ?? null;
  try {
    const card = (await api.cards.byIds([id]))[0] ?? null;
    byId.set(id, card);
    return card;
  } catch {
    return null;
  }
}

/** The cards with these names, once the card data is there. Null for names that aren't cards. */
export function useCardsByName(names: readonly string[]): readonly (Card | null)[] {
  const key = names.join('\n');
  const ready = useCardsReady();
  const [, setVersion] = useState(0);

  useEffect(() => {
    const missing = key.split('\n').filter((name) => name && !cache.has(name));
    if (!ready || missing.length === 0) return;
    let active = true;
    void api.cards.byNames(missing).then(
      (found) => {
        missing.forEach((name, i) => cache.set(name, found[i] ?? null));
        // Known by id too, for the other ways of asking.
        for (const card of found) if (card) byId.set(card.id, card);
        if (active) setVersion((v) => v + 1);
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [key, ready]);

  return names.map((name) => cache.get(name) ?? null);
}

/** Whether there's card data to look things up in. */
export function useCardsReady(): boolean {
  const [status, setStatus] = useState<CardDataStatus['state'] | 'usable'>('missing');
  useEffect(() => {
    let active = true;
    const update = (next: CardDataStatus) => {
      if (active)
        setStatus(next.state === 'ready' || (next.state === 'error' && next.count > 0) ? 'usable' : next.state);
    };
    const off = api.cards.onStatus(update);
    void api.cards.status().then(update);
    return () => {
      active = false;
      off();
    };
  }, []);
  return status === 'usable';
}

/** The cards with these ids, once the card data is there. Null for ids it doesn't have. */
export function useCardsById(ids: readonly string[]): ReadonlyMap<string, Card> {
  const key = [...new Set(ids)].sort().join('\n');
  const ready = useCardsReady();
  const [, setVersion] = useState(0);

  useEffect(() => {
    const missing = key.split('\n').filter((id) => id && !byId.has(id));
    if (!ready || missing.length === 0) return;
    let active = true;
    void api.cards.byIds(missing).then(
      (found) => {
        missing.forEach((id, i) => byId.set(id, found[i] ?? null));
        if (active) setVersion((v) => v + 1);
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [key, ready]);

  const cards = new Map<string, Card>();
  for (const id of key.split('\n')) {
    const card = byId.get(id);
    if (card) cards.set(id, card);
  }
  return cards;
}
