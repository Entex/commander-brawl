import type { GameView, LoggedEvent } from '@commander-brawl/application';
import type { SeatIndex } from '@commander-brawl/domain';
import { useEffect, useState } from 'react';
import { Icon } from '../icons/Icon';
import { seatColorClass } from '../seatColors';
import { submitGameEvent } from '../useGame';

/** How long a call to wait flashes on every screen. */
const SHOW_FOR_MS = 8_000;
/** Pressing again right away doesn't call again. */
const COOLDOWN_MS = 3_000;

/**
 * Calls to wait ("I have a response!") as they come in, oldest first. Each shows for a few seconds; ones from
 * before this screen opened aren't shown.
 */
export function useResponseCalls(game: GameView | null): readonly LoggedEvent[] {
  return useFreshLive(game, (entry) => entry.event.type === 'response-called', SHOW_FOR_MS);
}

/**
 * Live events of one kind as they come in, oldest first, each shown for `showForMs` after the newest one
 * arrives. Ones from before the screen opened aren't shown.
 */
export function useFreshLive(
  game: GameView | null,
  matches: (entry: LoggedEvent) => boolean,
  showForMs: number,
): readonly LoggedEvent[] {
  const entries = (game?.live ?? []).filter(matches);
  const [shownUpTo, setShownUpTo] = useState(() => entries.at(-1)?.seq ?? -1);
  const visible = entries.filter((entry) => entry.seq > shownUpTo);
  const newest = visible.at(-1)?.seq;
  useEffect(() => {
    if (newest === undefined) return;
    const timer = setTimeout(() => setShownUpTo((upTo) => Math.max(upTo, newest)), showForMs);
    return () => clearTimeout(timer);
  }, [newest, showForMs]);
  return visible;
}

/**
 * Big, on every screen: who wants everyone to wait. Clicks go through it, so it never covers a button (like
 * Pass turn) at the moment it matters.
 */
export function ResponseBanner({
  calls,
  self,
}: {
  readonly calls: readonly LoggedEvent[];
  readonly self: SeatIndex | null;
}) {
  if (calls.length === 0) return null;
  const others = [...new Set(calls.filter((c) => c.by.seat !== self).map((c) => c.by.name))];
  // In the color of whoever called last (when it's just one of them).
  const caller = others.length === 1 ? calls.findLast((c) => c.by.seat !== self)?.by.seat : undefined;
  const text =
    others.length === 0
      ? 'You asked everyone to wait'
      : others.length === 1
        ? `${others[0]}: “Wait, I have a response!”`
        : `${others.join(' and ')} have responses. Wait!`;
  return (
    <div className={`response-banner ${seatColorClass(caller)}`} role="alert" data-testid="response-banner">
      <Icon name="hand" /> {text}
    </div>
  );
}

/** "Wait, I have a response!", for when the game is moving on and you want to respond first. Also the W key. */
export function ResponseButton() {
  const [coolingDown, setCoolingDown] = useState(false);

  useEffect(() => {
    if (coolingDown) {
      const timer = setTimeout(() => setCoolingDown(false), COOLDOWN_MS);
      return () => clearTimeout(timer);
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'w' || event.ctrlKey || event.metaKey || event.altKey || isTyping(event)) return;
      event.preventDefault();
      call();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [coolingDown]);

  function call() {
    submitGameEvent({ type: 'response-called' });
    setCoolingDown(true);
  }

  return (
    <button
      className="response-button"
      onClick={call}
      disabled={coolingDown}
      title="Ask everyone to wait: you have a response (W)"
    >
      <Icon name="hand" /> Wait!
    </button>
  );
}

function isTyping(event: KeyboardEvent): boolean {
  const target = event.target;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}
