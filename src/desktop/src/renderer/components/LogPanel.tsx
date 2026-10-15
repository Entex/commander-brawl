import { undoneIds, type GameView, type LoggedEvent } from '@commander-brawl/application';
import type { GameEvent, GameState, SeatIndex } from '@commander-brawl/domain';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { describeEvent } from '../describeEvent';
import { Icon } from '../icons/Icon';
import type { Players } from '../names';
import { seatColorClass } from '../seatColors';

interface LogPanelProps {
  readonly game: GameView;
  readonly players: Players;
  onClose(): void;
}

/** Everything that happened at the table, newest first. */
export function LogPanel({ game, players, onClose }: LogPanelProps) {
  const log = useFullLog(game.logLength);
  const [seat, setSeat] = useState<SeatIndex | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const undone = useMemo(() => undoneIds(log), [log]);
  const find = useMemo(() => {
    const byId = new Map(log.map((entry) => [entry.id, entry]));
    return (id: string) => byId.get(id);
  }, [log]);
  const shown = log.filter((entry) => seat === null || involves(entry, seat)).reverse();

  const save = async () => {
    const ok = await api.game.saveLog(formatLog(log, players, game.state));
    setSaved(ok ? 'Saved.' : null);
  };

  return (
    <aside className="log-panel" aria-label="Game log" data-testid="log-panel">
      <header className="panel-header">
        <h2>
          <Icon name="scroll-unfurled" /> Game log
        </h2>
        <button onClick={onClose}>Close</button>
      </header>
      <div className="row">
        <select
          aria-label="Show"
          value={seat ?? ''}
          onChange={(event) => setSeat(event.target.value === '' ? null : (Number(event.target.value) as SeatIndex))}
        >
          <option value="">Everyone</option>
          {players.map((p) => (
            <option key={p.player.seat} value={p.player.seat}>
              {p.player.name}
            </option>
          ))}
        </select>
        <button onClick={() => void save()} disabled={log.length === 0}>
          Save as text
        </button>
      </div>
      {saved && <p className="hint">{saved}</p>}
      <ol className="log-entries">
        {shown.length === 0 && <li className="hint">Nothing yet.</li>}
        {shown.map((entry) => (
          <li
            key={entry.id}
            className={`${seatColorClass(entry.by.seat)} ${undone.has(entry.id) ? 'undone' : ''} ${entry.event.type === 'new-game' ? 'log-game' : ''}`}
          >
            <time>{formatTime(entry.at)}</time>
            <span>{describeEvent(entry, players, game.state, find)}</span>
            {undone.has(entry.id) && <span className="badge">undone</span>}
          </li>
        ))}
      </ol>
    </aside>
  );
}

function useFullLog(length: number): readonly LoggedEvent[] {
  const [log, setLog] = useState<readonly LoggedEvent[]>([]);
  useEffect(() => {
    let active = true;
    void api.game.log().then((entries) => {
      if (active) setLog(entries);
    });
    return () => {
      active = false;
    };
  }, [length]);
  return log;
}

/** The log as plain text, for saving after the game. */
export function formatLog(log: readonly LoggedEvent[], players: Players, game: GameState): string {
  const undone = undoneIds(log);
  const byId = new Map(log.map((entry) => [entry.id, entry]));
  const lines = log.map((entry) => {
    const text = describeEvent(entry, players, game, (id) => byId.get(id));
    return `${formatTime(entry.at)}  ${text}${undone.has(entry.id) ? '  (undone)' : ''}`;
  });
  const names = players.map((p) => p.player.name).join(', ');
  return [`Commander Brawl game log`, `Players: ${names}`, '', ...lines, ''].join('\n');
}

function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** Whether a log entry was made by, or is about, this seat. */
function involves(entry: LoggedEvent, seat: SeatIndex): boolean {
  return entry.by.seat === seat || seatsIn(entry.event).includes(seat);
}

function seatsIn(event: GameEvent): SeatIndex[] {
  switch (event.type) {
    case 'commander-damage':
      return [event.from, event.to];
    case 'turn-passed':
      return [event.from];
    case 'custom-counter-changed':
      return event.seat === null ? [] : [event.seat];
    case 'turn-order-set':
    case 'turn-order-chosen':
      return [...event.order];
    case 'seat-picked':
      return [event.picked];
    case 'archenemy-started':
      return [event.seat];
    case 'monarch-set':
    case 'initiative-taken':
      return event.seat === null ? [] : [event.seat];
    case 'ventured':
    case 'ring-tempted':
    case 'permanent-added':
    case 'permanent-removed':
    case 'permanent-count-changed':
    case 'permanent-tapped':
    case 'permanent-counter-changed':
    case 'permanent-moved':
    case 'permanent-identified':
    case 'marker-placed':
    case 'marker-changed':
    case 'marker-moved':
    case 'marker-removed':
    case 'marker-attached':
    case 'card-to-graveyard':
    case 'graveyard-card-removed':
    case 'citys-blessing-set':
    case 'life-changed':
    case 'deck-chosen':
    case 'deck-analyzed':
    case 'bracket-declared':
    case 'commanders-named':
    case 'out-set':
    case 'counter-changed':
    case 'commander-cast':
      return [event.seat];
    case 'reminder-set':
      return [...new Set([event.reminder.seat, ...event.reminder.turns])];
    case 'response-called':
      return event.seat === undefined ? [] : [event.seat];
    case 'call-resolved':
      return event.seat === undefined ? [] : [event.seat];
    case 'card-shown':
    case 'reminder-removed':
    case 'phase-set':
    case 'clock-set':
    case 'clock-paused':
    case 'clock-resumed':
    case 'day-night-set':
    case 'storm-changed':
    case 'dice-rolled':
    case 'coins-flipped':
    case 'planechase-started':
    case 'planar-die-rolled':
    case 'planeswalked':
    case 'planechase-ended':
    case 'scheme-set-in-motion':
    case 'scheme-abandoned':
    case 'archenemy-ended':
    case 'custom-counter-saved':
    case 'custom-counter-removed':
    case 'new-game':
    case 'undo':
      return [];
  }
}
