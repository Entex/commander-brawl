import {
  describeMoment,
  gamesInLog,
  recapText,
  turns,
  type GameRecord,
  type GameView,
} from '@commander-brawl/application';
import { isOut, type GameState, type SeatIndex } from '@commander-brawl/domain';
import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Players } from '../names';

/** A game's recap: standings, turns and key moments. Copy it for Discord, or save it as a file. */
export function RecapView({
  record,
  number,
  onClose,
}: {
  readonly record: GameRecord;
  readonly number?: number;
  onClose(): void;
}) {
  const [note, setNote] = useState<string | null>(null);
  const text = recapText(record, number);
  const nameAt = (seat: SeatIndex | null) =>
    seat === null ? null : (record.players.find((p) => p.seat === seat)?.name ?? `Seat ${seat + 1}`);
  const winner = nameAt(record.winner);
  const minutes = Math.round((record.endedAt - record.startedAt) / 60_000);
  const standings = [...record.players].sort((a, b) => (a.place ?? 9) - (b.place ?? 9));

  return (
    <div className="overlay" role="dialog" aria-label="Game recap">
      <div className="panel recap-panel" data-testid="recap">
        <header className="panel-header">
          <h2>{winner ? `${winner} won` : 'Game recap'}</h2>
          <button onClick={onClose}>Close</button>
        </header>
        <p className="hint">
          {number ? `Game ${number} · ` : ''}
          {turns(record.turns)} · {minutes} min
        </p>
        <ol className="recap-standings">
          {standings.map((p) => (
            <li key={p.seat}>
              <b>{p.name}</b>
              {(p.commanders.length > 0 || p.deck) && (
                <span className="hint"> · {[p.commanders.join(' & '), p.deck].filter(Boolean).join(', ')}</span>
              )}
              {p.out && <span className="hint"> · out on turn {p.out.turn}</span>}
            </li>
          ))}
        </ol>
        {record.moments && record.moments.length > 0 && (
          <section>
            <h3>Key moments</h3>
            <ul className="recap-moments">
              {record.moments.map((moment, i) => (
                <li key={i}>
                  Turn {moment.turn}: {describeMoment(moment, nameAt)}
                </li>
              ))}
            </ul>
          </section>
        )}
        <div className="row">
          <button
            className="primary"
            onClick={() =>
              void navigator.clipboard.writeText(text).then(() => setNote('Copied. Paste it into Discord.'))
            }
          >
            Copy as text
          </button>
          <button onClick={() => void api.game.saveRecap(text).then((saved) => saved && setNote('Saved.'))}>
            Save as file
          </button>
          {note && <span className="hint">{note}</span>}
        </div>
      </div>
    </div>
  );
}

/**
 * The recap of the game being played, once it's decided (one player left). A small banner says who won (it
 * doesn't get in the way: a player who's out may yet say they're still in); the recap opens from there, or
 * from the status bar until the next game starts.
 */
export function useLiveRecap(
  game: GameView | null,
  players: Players,
): {
  readonly record: GameRecord | null;
  readonly number: number | null;
  /** Show the "won" banner. */
  readonly banner: boolean;
  /** Show the recap itself. */
  readonly viewing: boolean;
  view(): void;
  close(): void;
} {
  const number = game?.state.number ?? null;
  const decided = game !== null && isDecided(game.state, players);
  const logLength = game?.logLength ?? 0;
  const [found, setFound] = useState<{ number: number; record: GameRecord } | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState<number | null>(null);
  // The seats' names, for the log's players who never did anything themselves.
  const names = players.map((p) => `${p.player.seat}:${p.player.name}`).join('\n');

  useEffect(() => {
    if (!decided || number === null) return;
    let active = true;
    const bySeat = new Map(
      names.split('\n').map((line) => [Number(line.split(':')[0]), line.slice(line.indexOf(':') + 1)]),
    );
    void api.game.log().then((entries) => {
      if (!active) return;
      const record = gamesInLog(entries, 'table', (seat) => bySeat.get(seat) ?? null).find(
        (r) => r.id === `table:${number}`,
      );
      if (record) setFound({ number, record });
    });
    return () => {
      active = false;
    };
  }, [decided, number, logLength, names]);

  const record = decided && found?.number === number ? found.record : null;
  return {
    record,
    number,
    banner: record !== null && dismissed !== number && viewing !== number,
    viewing: record !== null && viewing === number,
    view: () => setViewing(number),
    close: () => {
      setViewing(null);
      setDismissed(number);
    },
  };
}

/** "Friend won", with the recap a click away. */
export function GameOverBanner({
  record,
  onView,
  onClose,
}: {
  readonly record: GameRecord;
  onView(): void;
  onClose(): void;
}) {
  const winner = record.players.find((p) => p.seat === record.winner);
  if (!winner) return null;
  return (
    <div className="game-over" role="status" data-testid="game-over">
      <span>🏆 {winner.name} won</span>
      <button className="primary" onClick={onView}>
        Recap
      </button>
      <button aria-label="Close" onClick={onClose}>
        ×
      </button>
    </div>
  );
}

function isDecided(state: GameState, players: Players): boolean {
  const seated = players.map((p) => p.player.seat);
  if (seated.length < 2) return false;
  const left = seated.filter((seat) => !isOut(state, seat));
  return left.length === 1 && (state.turnOrder !== null || left.length < seated.length);
}
