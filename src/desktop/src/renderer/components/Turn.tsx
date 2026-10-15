import {
  COMBAT_STEPS,
  nextPhase,
  timeLeft,
  type Clock,
  type ClockKind,
  type GameState,
  type Phase,
  type SeatIndex,
} from '@commander-brawl/domain';
import { useEffect, useRef, useState } from 'react';
import { PHASE_LABELS, formatClock, seatName, type Players } from '../names';
import { Icon, type GameIconName } from '../icons/Icon';
import { isTyping, panelOpen } from '../keys';
import { seatColorClass } from '../seatColors';
import { submitGameEvent } from '../useGame';

/** The phases shown in the strip; combat opens up into its steps while it's on. */
const STRIP: readonly Phase[] = ['upkeep', 'draw', 'main1', 'combat', 'main2', 'end'];

const PHASE_ICONS: Record<Phase, GameIconName> = {
  upkeep: 'sunrise',
  draw: 'card-pickup',
  main1: 'magic-swirl',
  combat: 'crossed-swords',
  attackers: 'sword-brandish',
  blockers: 'checked-shield',
  damage: 'bloody-sword',
  main2: 'magic-swirl',
  end: 'night-sleep',
};

interface TurnControlsProps {
  readonly game: GameState;
  readonly players: Players;
  /** See GameView.hostClockOffset. */
  readonly hostClockOffset: number;
  /** Shown, without the buttons that change things (watching). */
  readonly readOnly?: boolean;
}

/** Whose turn it is, where they are in it, the clock, and passing the turn. Before the first turn: deciding the order. */
export function TurnControls({ game, players, hostClockOffset, readOnly = false }: TurnControlsProps) {
  const self = players.find((p) => p.isSelf)?.player.seat;
  const [ordering, setOrdering] = useState(false);
  useTurnKeys(game, self ?? null, !readOnly);
  if (game.turnOrder === null || game.activeSeat === null) {
    if (readOnly) return <span className="hint">The game hasn't started yet.</span>;
    return (
      <div className="turn">
        <button
          disabled={players.length === 0}
          onClick={() => submitGameEvent({ type: 'randomize-turn-order', seats: players.map((p) => p.player.seat) })}
        >
          <Icon name="cycle" /> Random turn order
        </button>
        <button disabled={players.length === 0} onClick={() => setOrdering(true)}>
          Set the order…
        </button>
        {game.clock && (
          <span className="hint">
            <Icon name="hourglass" /> Clock starts with the first turn
          </span>
        )}
        {ordering && <TurnOrderPanel players={players} onClose={() => setOrdering(false)} />}
      </div>
    );
  }
  const yours = game.activeSeat === self;
  return (
    <div className={`turn ${seatColorClass(game.activeSeat)}`} data-testid="turn">
      <span>
        Turn {game.turn} · Round {game.round} ·{' '}
        <strong className="turn-whose">{yours ? 'Your turn' : `${seatName(players, game.activeSeat)}'s turn`}</strong>
      </span>
      {game.phase && <PhaseStrip phase={game.phase} canChange={yours} />}
      {game.clock && (
        <ClockControl clock={game.clock} seat={game.activeSeat} hostClockOffset={hostClockOffset} readOnly={readOnly} />
      )}
      {yours && (
        <button
          className="primary"
          title="Pass the turn (Space)"
          onClick={() => submitGameEvent({ type: 'turn-passed', from: game.activeSeat! })}
        >
          Pass turn <Icon name="next-button" />
        </button>
      )}
    </div>
  );
}

/**
 * The turn order set by hand: the order around the real table, say. The first player starts, or a random one, with
 * the others following in this order.
 */
function TurnOrderPanel({ players, onClose }: { readonly players: Players; onClose(): void }) {
  const [order, setOrder] = useState(() => players.map((p) => p.player.seat).sort((a, b) => a - b));
  const move = (index: number, by: -1 | 1) =>
    setOrder((current) => {
      const next = [...current];
      [next[index], next[index + by]] = [next[index + by]!, next[index]!];
      return next;
    });
  const start = (action: 'chosen' | 'random-first') => {
    submitGameEvent(
      action === 'chosen' ? { type: 'turn-order-chosen', order } : { type: 'randomize-first-player', order },
    );
    onClose();
  };
  return (
    <div className="overlay" role="dialog" aria-label="Turn order" onClick={onClose}>
      <div className="panel turn-order-panel" onClick={(event) => event.stopPropagation()}>
        <header className="panel-header">
          <h2>
            <Icon name="cycle" /> Turn order
          </h2>
          <button onClick={onClose}>Close</button>
        </header>
        <p className="hint">Put the players in the order they take turns, like around your table.</p>
        <ol className="turn-order-list">
          {order.map((seat, index) => (
            <li key={seat} className={seatColorClass(seat)}>
              <span className="turn-order-name">{seatName(players, seat)}</span>
              <button
                aria-label={`Move ${seatName(players, seat)} up`}
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                ↑
              </button>
              <button
                aria-label={`Move ${seatName(players, seat)} down`}
                disabled={index === order.length - 1}
                onClick={() => move(index, 1)}
              >
                ↓
              </button>
            </li>
          ))}
        </ol>
        <div className="row">
          <button className="primary" onClick={() => start('chosen')}>
            {seatName(players, order[0]!)} goes first
          </button>
          <button onClick={() => start('random-first')} title="A random player starts; the others follow in this order">
            <Icon name="rolling-dices" /> A random player goes first
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * On your turn, Space passes the turn and Ctrl+Space moves to the next phase (Ctrl on a Mac too: ⌘+Space is
 * Spotlight). Not while typing, or with a panel open. At the table Space does nothing else, or it would press the
 * button clicked last (like "Lose 1 life") again.
 */
function useTurnKeys(game: GameState, self: SeatIndex | null, enabled: boolean): void {
  const latest = useRef({ game, self });
  useEffect(() => {
    latest.current = { game, self };
  });
  useEffect(() => {
    if (!enabled) return;
    let pressed = false;
    const isSpace = (event: KeyboardEvent) => event.code === 'Space' || event.key === ' ';
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isSpace(event) || event.altKey || event.shiftKey || event.metaKey || isTyping(event) || panelOpen()) return;
      event.preventDefault();
      pressed = true;
      if (event.repeat) return;
      const { game, self } = latest.current;
      if (game.activeSeat === null || game.activeSeat !== self) return;
      if (!event.ctrlKey) {
        submitGameEvent({ type: 'turn-passed', from: game.activeSeat });
      } else {
        const next = game.phase && nextPhase(game.phase);
        if (next) submitGameEvent({ type: 'phase-set', phase: next });
      }
    };
    // A button presses itself when Space is let go.
    const onKeyUp = (event: KeyboardEvent) => {
      if (pressed && isSpace(event)) {
        event.preventDefault();
        pressed = false;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [enabled]);
}

/** Where the active player is in their turn. They can click ahead (or back); everyone else just sees it. */
function PhaseStrip({ phase, canChange }: { readonly phase: Phase; readonly canChange: boolean }) {
  const inCombat = COMBAT_STEPS.includes(phase);
  const shown = STRIP.flatMap((p) => (p === 'combat' && inCombat ? COMBAT_STEPS : [p]));
  return (
    <div
      className="phases"
      role="group"
      aria-label="Phase of the turn"
      title={canChange ? 'Click a phase to go there, or Ctrl+Space for the next one' : undefined}
      data-testid="phases"
    >
      {shown.map((p) => {
        const className = `phase${p === phase ? ' phase-current' : ''}${COMBAT_STEPS.includes(p) ? ' phase-combat' : ''}`;
        return canChange ? (
          <button
            key={p}
            className={className}
            aria-pressed={p === phase}
            onClick={() => p !== phase && submitGameEvent({ type: 'phase-set', phase: p })}
          >
            <Icon name={PHASE_ICONS[p]} />
            {PHASE_LABELS[p]}
          </button>
        ) : (
          <span key={p} className={className} aria-current={p === phase ? 'step' : undefined}>
            <Icon name={PHASE_ICONS[p]} />
            {PHASE_LABELS[p]}
          </span>
        );
      })}
    </div>
  );
}

/** The active player's time, and a button anyone can use to stop the clock or start it again. */
function ClockControl({
  clock,
  seat,
  hostClockOffset,
  readOnly,
}: {
  readonly clock: Clock;
  readonly seat: SeatIndex;
  readonly hostClockOffset: number;
  readonly readOnly: boolean;
}) {
  const now = useHostNow(hostClockOffset, clock.running !== null);
  const left = timeLeft(clock, seat, now);
  const running = clock.running !== null;
  return (
    <span
      className={`clock${left < 0 ? ' clock-over' : ''}${running ? '' : ' clock-stopped'}`}
      data-testid="clock"
      title={clock.settings.kind === 'turn' ? 'Time left this turn' : 'Time left on their chess clock'}
    >
      <Icon name="hourglass" /> {formatClock(left)}
      {!running && <span className="clock-state">{clock.paused ? 'Paused' : 'Stopped'}</span>}
      {!readOnly && (
        <button onClick={() => submitGameEvent({ type: running ? 'clock-paused' : 'clock-resumed' })}>
          {running ? 'Pause' : 'Resume'}
        </button>
      )}
    </span>
  );
}

/** On a chess clock, every player's time left, on their seat. */
export function SeatClock({
  clock,
  seat,
  hostClockOffset,
}: {
  readonly clock: Clock;
  readonly seat: SeatIndex;
  readonly hostClockOffset: number;
}) {
  const running = clock.running?.seat === seat;
  const now = useHostNow(hostClockOffset, running);
  const left = timeLeft(clock, seat, now);
  return (
    <span
      className={`badge seat-clock${running ? ' seat-clock-running' : ''}${left < 0 ? ' clock-over' : ''}`}
      data-testid="seat-clock"
    >
      <Icon name="hourglass" /> {formatClock(left)}
    </span>
  );
}

/** The time on the host's clock, updated a few times a second while something is counting. */
function useHostNow(hostClockOffset: number, ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [ticking]);
  return now + hostClockOffset;
}

const DEFAULT_MINUTES: Record<ClockKind, number> = { turn: 3, chess: 25 };

/** Choosing a turn timer or chess clock (or none), usually before the game starts. */
export function ClockPanel({ clock, onClose }: { readonly clock: Clock | null; onClose(): void }) {
  const [kind, setKind] = useState<ClockKind | 'none'>(clock?.settings.kind ?? 'none');
  const [minutes, setMinutes] = useState(clock?.settings.minutes ?? DEFAULT_MINUTES.turn);
  const valid = Number.isInteger(minutes) && minutes >= 1 && minutes <= 240;

  const choose = (next: ClockKind | 'none') => {
    setKind(next);
    if (next !== 'none' && next !== kind) setMinutes(DEFAULT_MINUTES[next]);
  };

  return (
    <div className="overlay" role="dialog" aria-label="Clock" onClick={onClose}>
      <div className="panel clock-panel" onClick={(event) => event.stopPropagation()}>
        <header className="panel-header">
          <h2>
            <Icon name="hourglass" /> Clock
          </h2>
          <button onClick={onClose}>Close</button>
        </header>
        <p className="hint">
          Keeps games moving. Nobody loses for running out: it just shows. <b>Wait!</b> pauses it; the next phase or
          turn starts it again.
        </p>
        <fieldset className="clock-choices">
          <label>
            <input type="radio" name="clock" checked={kind === 'none'} onChange={() => choose('none')} /> No clock
          </label>
          <label>
            <input type="radio" name="clock" checked={kind === 'turn'} onChange={() => choose('turn')} /> Turn timer:
            the same time for every turn
          </label>
          <label>
            <input type="radio" name="clock" checked={kind === 'chess'} onChange={() => choose('chess')} /> Chess clock:
            a time bank per player for the whole game
          </label>
        </fieldset>
        {kind !== 'none' && (
          <label className="clock-minutes">
            Minutes {kind === 'turn' ? 'per turn' : 'per player'}
            <input
              type="number"
              min={1}
              max={240}
              value={Number.isNaN(minutes) ? '' : minutes}
              onChange={(event) => setMinutes(event.target.valueAsNumber)}
            />
          </label>
        )}
        <button
          className="primary"
          disabled={kind !== 'none' && !valid}
          onClick={() => {
            submitGameEvent({ type: 'clock-set', settings: kind === 'none' ? null : { kind, minutes } });
            onClose();
          }}
        >
          {kind === 'none'
            ? clock
              ? 'Turn the clock off'
              : 'Done'
            : clock
              ? 'Start over with this clock'
              : 'Use this clock'}
        </button>
      </div>
    </div>
  );
}
