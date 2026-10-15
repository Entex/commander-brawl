import {
  MAX_REMINDERS,
  MAX_REMINDER_TEXT_LENGTH,
  PHASES,
  type GameState,
  type Phase,
  type ReminderState,
  type SeatIndex,
} from '@commander-brawl/domain';
import { useEffect, useRef, useState } from 'react';
import { isTyping, panelOpen } from '../keys';
import { describeReminderTime } from '../describeEvent';
import { Icon } from '../icons/Icon';
import { PHASE_NAMES, seatName, type Players } from '../names';
import { seatColorClass } from '../seatColors';
import { submitGameEvent } from '../useGame';

/**
 * The reminders still to come, in the status bar: opens the list, and adding one. T opens it for a reminder on the
 * phase the turn is in, for the active player's turns.
 */
export function RemindersButton({
  game,
  players,
  selfSeat,
}: {
  readonly game: GameState;
  readonly players: Players;
  readonly selfSeat: SeatIndex | null;
}) {
  const [open, setOpen] = useState<{ readonly phase: Phase; readonly forSeats: readonly SeatIndex[] } | null>(null);
  const now = { phase: game.phase ?? 'upkeep', forSeats: game.activeSeat === null ? [] : [game.activeSeat] };
  const latest = useLatest(now);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 't' || event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTyping(event) || panelOpen()) return;
      event.preventDefault();
      setOpen(latest.current);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [latest]);
  const count = visibleReminders(game, selfSeat).length;
  return (
    <>
      <button
        onClick={() => setOpen({ phase: 'upkeep', forSeats: [] })}
        title="Reminders and waits on a phase: the game stops there until they're resolved (T: for this phase)"
      >
        <Icon name="ringing-bell" /> Reminders{count > 0 ? ` (${count})` : ''}
      </button>
      {open && (
        <RemindersPanel
          game={game}
          players={players}
          selfSeat={selfSeat}
          forSeats={open.forSeats}
          phase={open.phase}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}

/** Every reminder still to come, and a form to add one (for these players' turns, at first). */
export function RemindersPanel({
  game,
  players,
  selfSeat,
  forSeats,
  phase,
  onClose,
}: {
  readonly game: GameState;
  readonly players: Players;
  readonly selfSeat: SeatIndex | null;
  /** Whose turns a new reminder is for, at first. None: every turn. */
  readonly forSeats?: readonly SeatIndex[];
  /** The phase a new reminder is on, at first. */
  readonly phase?: Phase;
  onClose(): void;
}) {
  return (
    <div className="overlay" role="dialog" aria-label="Reminders" onClick={onClose}>
      <div className="panel reminders-panel" onClick={(event) => event.stopPropagation()}>
        <header className="panel-header">
          <h2>
            <Icon name="ringing-bell" /> Reminders
          </h2>
          <button onClick={onClose}>Close</button>
        </header>
        <p className="hint">
          When the game gets to a reminder's phase, it comes up for everyone and the game stops there until someone
          marks it resolved. For triggers that are easy to forget, like “at the beginning of each upkeep”, or to wait
          for a phase of someone's turn and respond then (kept to yourself until it comes up, if you like).
        </p>
        {visibleReminders(game, selfSeat).length > 0 && (
          <ul className="reminder-list" data-testid="reminder-list">
            {visibleReminders(game, selfSeat).map((reminder) => (
              <ReminderRow key={reminder.id} reminder={reminder} players={players} />
            ))}
          </ul>
        )}
        {selfSeat !== null && game.reminders.length < MAX_REMINDERS && (
          <ReminderForm
            players={players}
            selfSeat={selfSeat}
            forSeats={forSeats ?? []}
            phase={phase ?? 'upkeep'}
            onAdded={onClose}
          />
        )}
      </div>
    </div>
  );
}

function ReminderRow({ reminder, players }: { readonly reminder: ReminderState; readonly players: Players }) {
  return (
    <li className={seatColorClass(reminder.seat)}>
      <Icon name={reminder.stop ? 'stop-sign' : 'ringing-bell'} />
      <span className="reminder-text">
        <b>{describeReminderTime(reminder, players)}</b>
        {reminder.text ? `: ${reminder.text}` : ''}
        <span className="hint">
          {' '}
          · {reminder.once ? 'once' : 'until removed'}
          {reminder.hidden ? ', only you see it' : ''} · {seatName(players, reminder.seat)}
        </span>
      </span>
      <button
        className="link danger"
        aria-label={`Take away the reminder for ${describeReminderTime(reminder, players)}`}
        onClick={() => submitGameEvent({ type: 'reminder-removed', id: reminder.id })}
      >
        Remove
      </button>
    </li>
  );
}

function ReminderForm({
  players,
  selfSeat,
  forSeats,
  phase: initialPhase,
  onAdded,
}: {
  readonly players: Players;
  readonly selfSeat: SeatIndex;
  readonly forSeats: readonly SeatIndex[];
  readonly phase: Phase;
  onAdded(): void;
}) {
  const [phase, setPhase] = useState<Phase>(initialPhase);
  const [turns, setTurns] = useState<readonly SeatIndex[]>(forSeats);
  const [text, setText] = useState('');
  const [once, setOnce] = useState(false);
  const [hidden, setHidden] = useState(false);
  const seats = players.map((p) => p.player.seat).sort((a, b) => a - b);
  const opponents = seats.filter((seat) => seat !== selfSeat);
  const toggle = (seat: SeatIndex) =>
    setTurns((current) => (current.includes(seat) ? current.filter((s) => s !== seat) : [...current, seat]));
  const allOpponents = opponents.length > 0 && opponents.every((seat) => turns.includes(seat));
  // Every opponent's turns, or none of them (keeping your own).
  const toggleOpponents = () =>
    setTurns((current) =>
      allOpponents ? current.filter((seat) => !opponents.includes(seat)) : [...new Set([...current, ...opponents])],
    );

  return (
    <form
      className="reminder-form"
      onSubmit={(event) => {
        event.preventDefault();
        submitGameEvent({
          type: 'reminder-set',
          reminder: {
            id: crypto.randomUUID(),
            seat: selfSeat,
            phase,
            turns: [...turns].sort((a, b) => a - b),
            turn: null,
            text: text.trim(),
            once,
            stop: false,
            ...(hidden ? { hidden } : {}),
          },
        });
        onAdded();
      }}
    >
      <h3>New reminder</h3>
      <label>
        At
        <select value={phase} onChange={(event) => setPhase(event.target.value as Phase)} aria-label="Phase">
          {PHASES.map((p) => (
            <option key={p} value={p}>
              {PHASE_NAMES[p].replace(/^the /, '')}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="reminder-turns">
        <legend>On whose turns</legend>
        <label>
          <input type="checkbox" checked={turns.length === 0} onChange={() => setTurns([])} /> Everyone's
        </label>
        <label className={seatColorClass(selfSeat)}>
          <input type="checkbox" checked={turns.includes(selfSeat)} onChange={() => toggle(selfSeat)} /> Mine
        </label>
        {opponents.length > 0 && (
          <label>
            <input type="checkbox" checked={allOpponents} onChange={toggleOpponents} /> My opponents'
          </label>
        )}
        {opponents.map((seat) => (
          <label key={seat} className={seatColorClass(seat)}>
            <input type="checkbox" checked={turns.includes(seat)} onChange={() => toggle(seat)} />{' '}
            {seatName(players, seat)}'s
          </label>
        ))}
      </fieldset>
      <label>
        Text (if you like)
        <input
          value={text}
          maxLength={MAX_REMINDER_TEXT_LENGTH}
          placeholder="Rhystic Study: pay 1?"
          aria-label="Reminder text"
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <fieldset className="reminder-turns">
        <legend>How long</legend>
        <label>
          <input type="radio" name="reminder-how-long" checked={once} onChange={() => setOnce(true)} /> Just once
        </label>
        <label>
          <input type="radio" name="reminder-how-long" checked={!once} onChange={() => setOnce(false)} /> Until removed
        </label>
      </fieldset>
      <label className="checkbox">
        <input type="checkbox" checked={hidden} onChange={(event) => setHidden(event.target.checked)} /> Only I see it
        until it comes up
      </label>
      <button className="primary" type="submit">
        <Icon name="ringing-bell" /> Add the reminder
      </button>
    </form>
  );
}

/** The reminders this player can see: everyone's but the others' they keep to themselves until they come up. */
function visibleReminders(game: GameState, self: SeatIndex | null): readonly ReminderState[] {
  return game.reminders.filter((r) => !r.hidden || r.seat === self);
}

/** A ref that always holds the latest value, for listeners set up once. */
function useLatest<T>(value: T): { readonly current: T } {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}
