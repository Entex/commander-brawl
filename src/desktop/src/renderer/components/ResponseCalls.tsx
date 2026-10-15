import type { GameView, LoggedEvent } from '@commander-brawl/application';
import type { Call, GameState, SeatIndex } from '@commander-brawl/domain';
import { useEffect, useState } from 'react';
import { Icon, type GameIconName } from '../icons/Icon';
import { isTyping } from '../keys';
import { PHASE_NAMES, seatName, type Players } from '../names';
import { seatColorClass } from '../seatColors';
import { submitGameEvent } from '../useGame';

/** How long a call is big, in the middle of the table, before it settles to a smaller size. */
const BIG_FOR_MS = 8_000;
/** Pressing again right away doesn't call again. */
const COOLDOWN_MS = 3_000;

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

/** The seats of players waiting for a response they asked for. */
export function respondingSeats(game: GameState | null): ReadonlySet<SeatIndex> {
  return new Set((game?.calls ?? []).filter((call) => call.kind === 'wait').map((call) => call.seat));
}

/**
 * On every screen, in the middle of the table: the calls still to deal with (waits, reminders that came up, stops
 * reached), each with Resolved. Big when it comes up, then smaller. Clicks go through it, except on its buttons, so it
 * never covers a button (like Pass turn) at the moment it matters.
 */
export function CallsBanner({
  game,
  players,
  self,
  readOnly,
}: {
  readonly game: GameState;
  readonly players: Players;
  readonly self: SeatIndex | null;
  readonly readOnly: boolean;
}) {
  if (game.calls.length === 0) return null;
  return (
    <div className="calls" data-testid="calls">
      {game.calls.map((call) => (
        <CallRow key={call.id} call={call} players={players} self={self} readOnly={readOnly} />
      ))}
    </div>
  );
}

const CALL_ICONS: Record<Call['kind'], GameIconName> = { wait: 'hand', reminder: 'ringing-bell', stop: 'stop-sign' };

function CallRow({
  call,
  players,
  self,
  readOnly,
}: {
  readonly call: Call;
  readonly players: Players;
  readonly self: SeatIndex | null;
  readonly readOnly: boolean;
}) {
  const [big, setBig] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setBig(false), BIG_FOR_MS);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div
      className={`call call-${call.kind}${big ? ' call-big' : ''} ${seatColorClass(call.seat)}`}
      role="alert"
      data-testid="call"
    >
      <Icon name={CALL_ICONS[call.kind]} />
      <span className="call-text">{describeCall(call, players, self)}</span>
      {!readOnly && (
        <button
          className="call-resolve"
          onClick={() => submitGameEvent({ type: 'call-resolved', id: call.id, kind: call.kind, seat: call.seat })}
        >
          <Icon name="check-mark" /> Resolved
        </button>
      )}
    </div>
  );
}

/** "Alex: “Wait, I have a response!”", "Reminder for Alex's upkeep: Rhystic Study tax?", "Robin asked to stop here". */
export function describeCall(call: Call, players: Players, self: SeatIndex | null): string {
  const who = call.seat === self ? 'You' : seatName(players, call.seat);
  const where =
    call.phase === null || call.activeSeat === null
      ? ''
      : `${call.activeSeat === self ? 'your' : `${seatName(players, call.activeSeat)}'s`} ${PHASE_NAMES[call.phase].replace(/^the /, '')}`;
  switch (call.kind) {
    case 'wait':
      return call.seat === self ? 'You asked everyone to wait' : `${who}: “Wait, I have a response!”`;
    case 'stop':
      return `${who} asked to stop at ${where}${call.text ? `: ${call.text}` : ''}`;
    case 'reminder':
      return `Reminder${where ? ` (${where})` : ''}${call.text ? `: ${call.text}` : ''} · set by ${who}`;
  }
}

/** "Wait, I have a response!", for when the game is moving on and you want to respond first. Also the W key. */
export function ResponseButton({ seat }: { readonly seat: SeatIndex | null }) {
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
  });

  function call() {
    if (seat === null) return;
    submitGameEvent({ type: 'response-called', call: crypto.randomUUID(), seat });
    setCoolingDown(true);
  }

  return (
    <button
      className="response-button"
      onClick={call}
      disabled={coolingDown || seat === null}
      title="Ask everyone to wait: you have a response (W)"
    >
      <Icon name="hand" /> Wait!
    </button>
  );
}
