import {
  MAX_REMINDERS,
  MAX_REMINDER_TEXT_LENGTH,
  PHASES,
  type GameState,
  type Phase,
  type ReminderState,
  type SeatIndex,
} from '@commander-brawl/domain';
import { useState } from 'react';
import { describeReminderTime } from '../describeEvent';
import { Icon } from '../icons/Icon';
import { PHASE_NAMES, seatName, type Players } from '../names';
import { seatColorClass } from '../seatColors';
import { submitGameEvent } from '../useGame';

/** The reminders still to come, in the status bar: opens the list, and adding one. */
export function RemindersButton({
  game,
  players,
  selfSeat,
}: {
  readonly game: GameState;
  readonly players: Players;
  readonly selfSeat: SeatIndex | null;
}) {
  const [open, setOpen] = useState(false);
  // Stops show on the phases; this is for the trigger reminders.
  const count = game.reminders.filter((r) => !r.stop || r.text).length;
  return (
    <>
      <button onClick={() => setOpen(true)} title="Trigger reminders on a phase, for everyone to see when it comes">
        <Icon name="ringing-bell" /> Reminders{count > 0 ? ` (${count})` : ''}
      </button>
      {open && <RemindersPanel game={game} players={players} selfSeat={selfSeat} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Every reminder still to come, and a form to add one (for these players' turns, at first). */
export function RemindersPanel({
  game,
  players,
  selfSeat,
  forSeats,
  onClose,
}: {
  readonly game: GameState;
  readonly players: Players;
  readonly selfSeat: SeatIndex | null;
  /** Whose turns a new reminder is for, at first. None: every turn. */
  readonly forSeats?: readonly SeatIndex[];
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
          A reminder comes up for everyone at its phase, and stays until someone marks it resolved. For triggers that
          are easy to forget, like “at the beginning of each upkeep”.
        </p>
        {game.reminders.length > 0 && (
          <ul className="reminder-list" data-testid="reminder-list">
            {game.reminders.map((reminder) => (
              <ReminderRow key={reminder.id} reminder={reminder} players={players} />
            ))}
          </ul>
        )}
        {selfSeat !== null && game.reminders.length < MAX_REMINDERS && (
          <ReminderForm players={players} selfSeat={selfSeat} forSeats={forSeats ?? []} onAdded={onClose} />
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
          · {reminder.once ? 'once' : 'every time'}
          {reminder.stop ? ', stops there' : ''} · {seatName(players, reminder.seat)}
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
  onAdded,
}: {
  readonly players: Players;
  readonly selfSeat: SeatIndex;
  readonly forSeats: readonly SeatIndex[];
  onAdded(): void;
}) {
  const [phase, setPhase] = useState<Phase>('upkeep');
  const [turns, setTurns] = useState<readonly SeatIndex[]>(forSeats);
  const [text, setText] = useState('');
  const [once, setOnce] = useState(false);
  const [stop, setStop] = useState(false);
  const seats = players.map((p) => p.player.seat).sort((a, b) => a - b);
  const toggle = (seat: SeatIndex) =>
    setTurns((current) => (current.includes(seat) ? current.filter((s) => s !== seat) : [...current, seat]));

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
            stop,
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
        {seats.map((seat) => (
          <label key={seat} className={seatColorClass(seat)}>
            <input type="checkbox" checked={turns.includes(seat)} onChange={() => toggle(seat)} />{' '}
            {seat === selfSeat ? 'Mine' : `${seatName(players, seat)}'s`}
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
      <label>
        <input type="checkbox" checked={once} onChange={(event) => setOnce(event.target.checked)} /> Just once
      </label>
      <label>
        <input type="checkbox" checked={stop} onChange={(event) => setStop(event.target.checked)} /> Stop there until
        it's resolved
      </label>
      <button className="primary" type="submit">
        <Icon name="ringing-bell" /> Add the reminder
      </button>
    </form>
  );
}
