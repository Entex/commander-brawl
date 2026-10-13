import type { GameView } from '@commander-brawl/application';
import type { GameAction } from '@commander-brawl/domain';
import { useEffect, useState } from 'react';
import { api } from './api';

/** The shared game, kept in sync by the main process. Null until you're at a table. */
export function useGame(): GameView | null {
  const [view, setView] = useState<GameView | null>(null);
  useEffect(() => {
    let active = true;
    const off = api.game.onView((next) => {
      if (active) setView(next);
    });
    void api.game.view().then((initial) => {
      // An update may have arrived while we were asking. It's newer, so keep it.
      if (active && initial) setView((current) => current ?? initial);
    });
    return () => {
      active = false;
      off();
    };
  }, []);
  return view;
}

export function submitGameEvent(event: GameAction): void {
  api.game.submit(event);
}
