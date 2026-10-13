import { historyStats, turns, type GameRecord, type OutReason } from '@commander-brawl/application';
import { useEffect, useState } from 'react';
import { api, errorMessage } from '../api';
import { RecapView } from './RecapView';

const HOW: Record<OutReason, string> = {
  life: 'life',
  poison: 'poison',
  'commander-damage': 'commander damage',
  'custom-counter': 'a counter',
  conceded: 'conceded',
};

/** Finished games kept on this computer, and stats from them. Shared with friends by exporting a file. */
export function HistoryPanel({ onClose }: { onClose(): void }) {
  const [games, setGames] = useState<readonly GameRecord[] | null>(null);
  const [tab, setTab] = useState<'stats' | 'games'>('stats');
  const [note, setNote] = useState<string | null>(null);
  const [recap, setRecap] = useState<GameRecord | null>(null);

  useEffect(() => {
    void api.history.list().then(setGames);
  }, []);

  const importFile = async () => {
    try {
      const added = await api.history.import();
      if (added === null) return;
      setNote(added === 0 ? 'Those games were all here already.' : `Added ${added} game${added === 1 ? '' : 's'}.`);
      setGames(await api.history.list());
    } catch (error) {
      setNote(errorMessage(error));
    }
  };

  const exportFile = async () => {
    if (await api.history.export()) setNote('Saved. Send the file to your friends to add to theirs.');
  };

  const stats = games ? historyStats(games) : null;
  return (
    <>
      {recap && <RecapView record={recap} onClose={() => setRecap(null)} />}
      <div className="overlay" role="dialog" aria-label="Game history">
        <div className="panel history-panel" data-testid="history-panel">
          <header className="panel-header">
            <h2>Game history</h2>
            <button onClick={onClose}>Close</button>
          </header>
          <div className="row">
            <div className="tabs" role="tablist">
              <button role="tab" aria-selected={tab === 'stats'} onClick={() => setTab('stats')}>
                Stats
              </button>
              <button role="tab" aria-selected={tab === 'games'} onClick={() => setTab('games')}>
                Games ({games?.length ?? 0})
              </button>
            </div>
            <button onClick={() => void exportFile()} disabled={!games || games.length === 0}>
              Export
            </button>
            <button onClick={() => void importFile()}>Import…</button>
          </div>
          {note && <p className="hint">{note}</p>}
          {games && games.length === 0 && (
            <p className="hint">
              No finished games yet. A game counts once it's decided (one player left) and the table starts a new one or
              closes.
            </p>
          )}
          {games && games.length > 0 && stats && tab === 'stats' && (
            <>
              <table className="history-table" aria-label="Players">
                <thead>
                  <tr>
                    <th>Player</th>
                    <th>Games</th>
                    <th>Wins</th>
                    <th>Win rate</th>
                    <th>Average game</th>
                    <th>Knockouts</th>
                    <th>With commander damage</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.players.map((p) => (
                    <tr key={p.name}>
                      <td>{p.name}</td>
                      <td>{p.games}</td>
                      <td>{p.wins}</td>
                      <td>{Math.round((100 * p.wins) / p.games)}%</td>
                      <td>{Math.round(p.averageMinutes)} min</td>
                      <td>{p.eliminations}</td>
                      <td>{p.commanderDamageKills}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {stats.decks.length > 0 && (
                <table className="history-table" aria-label="Decks">
                  <thead>
                    <tr>
                      <th>Deck</th>
                      <th>Player</th>
                      <th>Games</th>
                      <th>Win rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.decks.map((d) => (
                      <tr key={`${d.player}-${d.deck}`}>
                        <td>{d.deck}</td>
                        <td>{d.player}</td>
                        <td>{d.games}</td>
                        <td>{Math.round((100 * d.wins) / d.games)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {stats.eliminations.length > 0 && (
                <section>
                  <h3>Who knocked out whom</h3>
                  <ul className="history-eliminations">
                    {stats.eliminations.map((e) => (
                      <li key={`${e.by}-${e.out}`}>
                        {e.by} → {e.out}: {e.times}×
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
          {games && games.length > 0 && tab === 'games' && (
            <ul className="history-games" aria-label="Games">
              {[...games].reverse().map((game) => (
                <li key={game.id}>
                  <GameLine game={game} />
                  <button onClick={() => setRecap(game)}>Recap</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}

function GameLine({ game }: { readonly game: GameRecord }) {
  const winner = game.players.find((p) => p.seat === game.winner);
  const minutes = Math.round((game.endedAt - game.startedAt) / 60_000);
  const date = new Date(game.startedAt).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
  return (
    <>
      <p>
        <b>{date}</b> · {turns(game.turns)} · {minutes} min · {winner ? `${winner.name} won` : 'undecided'}
      </p>
      <ol className="history-standings">
        {[...game.players]
          .sort((a, b) => (a.place ?? 9) - (b.place ?? 9))
          .map((p) => {
            const by = p.out?.by != null ? game.players.find((q) => q.seat === p.out!.by)?.name : null;
            return (
              <li key={p.seat}>
                {p.name}
                {p.deck && <span className="hint"> · {p.deck}</span>}
                {p.out && (
                  <span className="hint">
                    {' '}
                    · out on turn {p.out.turn} ({HOW[p.out.reason]}
                    {by ? `, by ${by}` : ''})
                  </span>
                )}
              </li>
            );
          })}
      </ol>
    </>
  );
}
