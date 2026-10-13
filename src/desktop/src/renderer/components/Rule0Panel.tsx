import {
  BRACKET_NAMES,
  bracketConcerns,
  deckSize,
  isBracket,
  type Bracket,
  type GameState,
  type SeatIndex,
} from '@commander-brawl/domain';
import { Icon } from '../icons/Icon';
import type { Players } from '../names';
import { submitGameEvent } from '../useGame';

interface Rule0PanelProps {
  readonly game: GameState;
  readonly players: Players;
  readonly selfSeat: SeatIndex | null;
  onClose(): void;
}

const BRACKETS: readonly Bracket[] = [1, 2, 3, 4, 5];

/**
 * The talk before the game: how strong is everyone's deck? Each player says their bracket, and the app
 * points out anything in the decks that doesn't fit, so it can be talked about instead of discovered.
 */
export function Rule0Panel({ game, players, selfSeat, onClose }: Rule0PanelProps) {
  return (
    <div className="overlay" role="dialog" aria-label="Rule 0">
      <div className="panel rule0-panel" data-testid="rule0-panel">
        <header className="panel-header">
          <h2>
            <Icon name="scales" /> Rule 0
          </h2>
          <button onClick={onClose}>Done</button>
        </header>
        <p className="hint">
          Say how strong your deck is, from 1 (Exhibition) to 5 (cEDH). The app checks each deck that's been picked and
          points out what doesn't usually fit its bracket. It's there to talk about, not a rule.
        </p>
        {[...players]
          .sort((a, b) => a.player.seat - b.player.seat)
          .map((p) => (
            <PlayerRow
              key={p.player.id}
              game={game}
              seat={p.player.seat}
              name={p.player.name}
              self={p.player.seat === selfSeat}
            />
          ))}
      </div>
    </div>
  );
}

function PlayerRow({
  game,
  seat,
  name,
  self,
}: {
  readonly game: GameState;
  readonly seat: SeatIndex;
  readonly name: string;
  readonly self: boolean;
}) {
  const state = game.seats[seat];
  if (!state) return null;
  const { deck, deckAnalysis: analysis, bracket } = state;
  const concerns = bracket && analysis ? bracketConcerns(bracket, analysis) : [];

  return (
    <section className="rule0-player" data-testid={`rule0-${seat}`}>
      <div className="rule0-heading">
        <h3>{self ? `${name} (you)` : name}</h3>
        {self ? (
          <select
            aria-label="Your bracket"
            value={bracket ?? ''}
            onChange={(event) => {
              const value = Number(event.target.value);
              submitGameEvent({ type: 'bracket-declared', seat, bracket: isBracket(value) ? value : null });
            }}
          >
            <option value="">Bracket not said</option>
            {BRACKETS.map((b) => (
              <option key={b} value={b}>
                Bracket {b}: {BRACKET_NAMES[b]}
              </option>
            ))}
          </select>
        ) : (
          <span className="badge">
            {bracket ? `Bracket ${bracket}: ${BRACKET_NAMES[bracket]}` : 'Bracket not said'}
          </span>
        )}
      </div>

      {!deck && <p className="hint">No deck picked yet{self ? ' (Menu → Decks).' : '.'}</p>}
      {deck && (
        <p className="rule0-deck">
          {deck.name} · {deck.commanders.map((c) => c.name).join(' & ') || 'no commander'} · {deckSize(deck)} cards
        </p>
      )}
      {deck && !analysis && <p className="hint">Checking the deck…</p>}
      {analysis && (
        <ul className="rule0-facts">
          <li>
            {analysis.gameChangers.length === 0
              ? 'No Game Changers'
              : `Game Changers (${analysis.gameChangers.length}): ${analysis.gameChangers.join(', ')}`}
          </li>
          {analysis.complete ? (
            <>
              {analysis.combos ? (
                <li>
                  {analysis.combos.length === 0 ? (
                    'No combos'
                  ) : (
                    <>
                      Combos ({analysis.combos.length}):
                      <ul className="rule0-combos" data-testid="combos">
                        {analysis.combos.map((combo) => (
                          <li key={combo.cards.join('+')}>
                            {combo.cards.join(' + ')}
                            {combo.produces.length > 0 && (
                              <span className="hint"> → {combo.produces.slice(0, 2).join(', ')}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </li>
              ) : (
                <li>
                  {analysis.twoCardCombos.length === 0
                    ? 'No two-card combos'
                    : `Two-card combos: ${analysis.twoCardCombos.map((c) => c.cards.join(' + ')).join('; ')}`}
                </li>
              )}
              {analysis.massLandDenial.length > 0 && <li>Mass land denial: {analysis.massLandDenial.join(', ')}</li>}
              {analysis.extraTurns.length > 0 && <li>Extra turns: {analysis.extraTurns.join(', ')}</li>}
            </>
          ) : (
            <li className="hint">
              Combos, land denial and extra turns weren't checked: Commander Spellbook couldn't be reached.
            </li>
          )}
        </ul>
      )}
      {concerns.length > 0 && (
        <ul className="rule0-concerns" aria-label="Doesn't fit the bracket">
          {concerns.map((concern) => (
            <li key={concern}>{concern}</li>
          ))}
        </ul>
      )}
      {bracket && analysis && concerns.length === 0 && <p className="status status-live">Fits bracket {bracket}.</p>}
    </section>
  );
}
