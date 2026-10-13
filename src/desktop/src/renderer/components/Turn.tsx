import {
  COMBAT_STEPS,
  timeLeft,
  type Clock,
  type ClockKind,
  type GameState,
  type Phase,
  type SeatIndex,
} from '@commander-brawl/domain';
import { useEffect, useState } from 'react';
import { PHASE_LABELS, formatClock, seatName, type Players } from '../names';
import { submitGameEvent } from '../useGame';

/** The phases shown in the strip; combat opens up into its steps while it's on. */
const STRIP: readonly Phase[] = ['upkeep', 'draw', 'main1', 'combat', 'main2', 'end'];

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
  if (game.turnOrder === null || game.activeSeat === null) {
    if (readOnly) return <span className="hint">The game hasn't started yet.</span>;
    return (
      <div className="turn">
        <button
          disabled={players.length === 0}
          onClick={() => submitGameEvent({ type: 'randomize-turn-order', seats: players.map((p) => p.player.seat) })}
        >
          Random turn order
        </button>
        {game.clock && <span className="hint">⏱ Clock starts with the first turn</span>}
      </div>
    );
  }
  const yours = game.activeSeat === self;
  return (
    <div className="turn" data-testid="turn">
      <span>
        Turn {game.turn} · Round {game.round} ·{' '}
        <strong>{yours ? 'Your turn' : `${seatName(players, game.activeSeat)}'s turn`}</strong>
      </span>
      {game.phase && <PhaseStrip phase={game.phase} canChange={yours} />}
      {game.clock && (
        <ClockControl clock={game.clock} seat={game.activeSeat} hostClockOffset={hostClockOffset} readOnly={readOnly} />
      )}
      {yours && (
        <button className="primary" onClick={() => submitGameEvent({ type: 'turn-passed', from: game.activeSeat! })}>
          Pass turn
        </button>
      )}
    </div>
  );
}

/** Where the active player is in their turn. They can click ahead (or back); everyone else just sees it. */
function PhaseStrip({ phase, canChange }: { readonly phase: Phase; readonly canChange: boolean }) {
  const inCombat = COMBAT_STEPS.includes(phase);
  const shown = STRIP.flatMap((p) => (p === 'combat' && inCombat ? COMBAT_STEPS : [p]));
  return (
    <div className="phases" role="group" aria-label="Phase of the turn" data-testid="phases">
      {shown.map((p) => {
        const className = `phase${p === phase ? ' phase-current' : ''}${COMBAT_STEPS.includes(p) ? ' phase-combat' : ''}`;
        return canChange ? (
          <button
            key={p}
            className={className}
            aria-pressed={p === phase}
            onClick={() => p !== phase && submitGameEvent({ type: 'phase-set', phase: p })}
          >
            {PHASE_LABELS[p]}
          </button>
        ) : (
          <span key={p} className={className} aria-current={p === phase ? 'step' : undefined}>
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
      ⏱ {formatClock(left)}
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
      ⏱ {formatClock(left)}
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
          <h2>Clock</h2>
          <button onClick={onClose}>Close</button>
        </header>
        <p className="hint">
          Keeps games moving. Nobody loses for running out: it just shows. ✋ Wait! pauses it; the next phase or turn
          starts it again.
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
