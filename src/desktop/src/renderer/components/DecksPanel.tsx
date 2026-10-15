import { chooseCommanders, type ImportedDeck } from '@commander-brawl/application';
import { MAX_COMMANDERS, MAX_DECK_NAME_LENGTH, deckSize, type DeckList, type SeatIndex } from '@commander-brawl/domain';
import { useEffect, useState } from 'react';
import type { SavedDeck } from '../../shared/api';
import { api, errorMessage } from '../api';
import { Icon } from '../icons/Icon';
import { submitGameEvent } from '../useGame';

interface DecksPanelProps {
  /** Your seat, when you're at a table: then you can pick the deck you're playing. */
  readonly seat: SeatIndex | null;
  /** The deck you're playing at the table right now. */
  readonly playing: DeckList | null;
  onClose(): void;
}

/** Your decks: import them from a deck site's link or a pasted list, and pick the one you're playing. */
export function DecksPanel({ seat, playing, onClose }: DecksPanelProps) {
  const [decks, setDecks] = useState<readonly SavedDeck[]>([]);
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportedDeck | null>(null);

  useEffect(() => {
    let active = true;
    void api.decks.list().then((list) => {
      if (active) setDecks(list);
    });
    return () => {
      active = false;
    };
  }, []);

  const runImport = async () => {
    setBusy(true);
    setError(null);
    try {
      setPreview(await api.decks.import(source));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const save = async (deck: DeckList) => {
    setError(null);
    try {
      const saved = await api.decks.save(deck, null);
      setDecks([saved, ...decks]);
      setPreview(null);
      setSource('');
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const play = (deck: DeckList) => {
    if (seat !== null) playDeck(seat, deck);
  };

  return (
    <div className="overlay" role="dialog" aria-label="Decks">
      <div className="panel decks-panel" data-testid="decks-panel">
        <header className="panel-header">
          <h2>
            <Icon name="card-draw" /> Decks
          </h2>
          <button onClick={onClose}>Done</button>
        </header>

        <section className="deck-list-section">
          <h3>Your decks</h3>
          {decks.length === 0 && <p className="hint">None yet. Import one below.</p>}
          <div className="deck-list" data-testid="deck-list">
            {decks.map((deck) => {
              const isPlaying = playing !== null && sameDeck(playing, deck);
              return (
                <div key={deck.id} className="deck-row" data-testid={`deck-${deck.name}`}>
                  <div className="deck-summary">
                    <strong>{deck.name}</strong>
                    <span className="hint">
                      {deck.commanders.map((c) => c.name).join(' & ') || 'No commander'} · {deckSize(deck)} cards
                    </span>
                  </div>
                  {seat !== null &&
                    (isPlaying ? (
                      <span className="badge badge-ok">Playing</span>
                    ) : (
                      <button className="primary" onClick={() => play(deck)}>
                        Play this deck
                      </button>
                    ))}
                  <button
                    className="danger"
                    onClick={() => {
                      void api.decks.remove(deck.id);
                      setDecks(decks.filter((d) => d.id !== deck.id));
                    }}
                  >
                    Delete
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        {preview ? (
          <DeckPreview imported={preview} onSave={(deck) => void save(deck)} onCancel={() => setPreview(null)} />
        ) : (
          <section className="deck-import">
            <h3>Import a deck</h3>
            <textarea
              aria-label="Deck link or list"
              rows={6}
              placeholder={
                "A Moxfield, Archidekt or other deck link, or the deck list:\n1 Atraxa, Praetors' Voice *CMDR*\n1 Sol Ring\n…"
              }
              value={source}
              onChange={(event) => setSource(event.target.value)}
            />
            <button className="primary" disabled={busy || !source.trim()} onClick={() => void runImport()}>
              {busy ? 'Importing…' : 'Import'}
            </button>
            <p className="hint">
              Links from Moxfield, Archidekt, TappedOut, Deckstats and Scryfall are read by{' '}
              <a href="https://commanderspellbook.com" target="_blank" rel="noreferrer">
                Commander Spellbook
              </a>
              .
            </p>
          </section>
        )}
        {/* Under the import, or under the deck it found when saving that didn't work. */}
        {error && <p className="status status-reconnecting">{error}</p>}
      </div>
    </div>
  );
}

interface DeckPreviewProps {
  readonly imported: ImportedDeck;
  onSave(deck: DeckList): void;
  onCancel(): void;
}

/** What the import found, so the player can name the deck and pick commanders before saving. */
function DeckPreview({ imported, onSave, onCancel }: DeckPreviewProps) {
  const [name, setName] = useState(imported.deck.name);
  const [chosen, setChosen] = useState<readonly string[]>([]);
  const needsCommander = imported.deck.commanders.length === 0;
  const deck = needsCommander ? chooseCommanders(imported.deck, chosen) : imported.deck;
  const size = deckSize(deck);

  return (
    <section className="deck-preview" aria-label="Imported deck">
      <h3>Imported</h3>
      <label className="field">
        <span>Name</span>
        <input value={name} maxLength={MAX_DECK_NAME_LENGTH} onChange={(event) => setName(event.target.value)} />
      </label>
      {needsCommander ? (
        <div className="field commander-candidates">
          <span>The list didn't say which card is the commander. Pick it (two for partners):</span>
          {imported.commanderCandidates.length === 0 && <p className="hint">No legendary creatures in the list.</p>}
          {imported.commanderCandidates.map((candidate) => (
            <label key={candidate.id} className="checkbox">
              <input
                type="checkbox"
                checked={chosen.includes(candidate.id)}
                disabled={!chosen.includes(candidate.id) && chosen.length >= MAX_COMMANDERS}
                onChange={(event) =>
                  setChosen(
                    event.target.checked ? [...chosen, candidate.id] : chosen.filter((id) => id !== candidate.id),
                  )
                }
              />
              {candidate.name}
            </label>
          ))}
        </div>
      ) : (
        <p>
          Commander: <strong>{deck.commanders.map((c) => c.name).join(' & ')}</strong>
        </p>
      )}
      <p className={size === 100 ? 'hint' : 'status status-reconnecting'}>
        {size} cards{size === 100 ? '' : ' (a Commander deck has 100)'}.
      </p>
      {imported.unknown.length > 0 && (
        <p className="status status-reconnecting">
          Not found, so left out: {imported.unknown.join(', ')}. Check the spelling, or that the card exists.
        </p>
      )}
      <div className="row">
        <button onClick={onCancel}>Cancel</button>
        <button className="primary" disabled={!name.trim()} onClick={() => onSave({ ...deck, name: name.trim() })}>
          Save deck
        </button>
      </div>
    </section>
  );
}

/** The player at this seat plays this deck: everyone's told, and its bracket check follows. */
export function playDeck(seat: SeatIndex, deck: DeckList): void {
  const { name, commanders, cards } = deck;
  const chosen = { name, commanders, cards };
  submitGameEvent({ type: 'deck-chosen', seat, deck: chosen });
  // The bracket check needs Commander Spellbook, so it follows when it's done instead of holding this up.
  void api.decks
    .analyze(chosen)
    .then((analysis) => submitGameEvent({ type: 'deck-analyzed', seat, deckName: name, analysis }))
    .catch((error: unknown) => console.warn('[decks] could not check the deck', error));
}

interface DeckPromptProps {
  readonly seat: SeatIndex;
  /** Opens the Decks panel, to import a deck. */
  onImport(): void;
  /** Playing without a deck this game. */
  onSkip(): void;
}

/**
 * When a game starts and the player hasn't said which deck they're playing: their saved decks to pick from, why
 * it's worth it (close-ups of their cards are compared with the deck's cards and artwork), and going on without.
 */
export function DeckPrompt({ seat, onImport, onSkip }: DeckPromptProps) {
  const [decks, setDecks] = useState<readonly SavedDeck[] | null>(null);
  useEffect(() => {
    let active = true;
    void api.decks.list().then((list) => {
      if (active) setDecks(list);
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="overlay" role="dialog" aria-label="Which deck are you playing?">
      <div className="panel deck-prompt" data-testid="deck-prompt">
        <h2>
          <Icon name="card-draw" /> Which deck are you playing?
        </h2>
        <p>
          With your deck, close-ups of your cards are recognized much better: they're compared with the cards in your
          deck, and their artwork, instead of every card there is. Your commanders show on your seat, and Rule 0 checks
          the deck too.
        </p>
        {decks !== null && decks.length === 0 && <p className="hint">You haven't imported a deck yet.</p>}
        <div className="deck-list">
          {decks?.map((deck) => (
            <div key={deck.id} className="deck-row" data-testid={`prompt-deck-${deck.name}`}>
              <div className="deck-summary">
                <strong>{deck.name}</strong>
                <span className="hint">
                  {deck.commanders.map((c) => c.name).join(' & ') || 'No commander'} · {deckSize(deck)} cards
                </span>
              </div>
              <button className="primary" onClick={() => playDeck(seat, deck)}>
                Play this deck
              </button>
            </div>
          ))}
        </div>
        <div className="row">
          <button onClick={onImport}>
            <Icon name="card-draw" /> Import a deck…
          </button>
          <button onClick={onSkip}>Continue without a deck</button>
        </div>
      </div>
    </div>
  );
}

function sameDeck(a: DeckList, b: DeckList): boolean {
  return (
    a.name === b.name &&
    a.cards.length === b.cards.length &&
    a.commanders.map((c) => c.id).join() === b.commanders.map((c) => c.id).join()
  );
}
