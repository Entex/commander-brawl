import type { CardGuess } from '@commander-brawl/application';
import type { Card, SeatIndex } from '@commander-brawl/domain';
import { cardImageUrl } from '@commander-brawl/infrastructure/browser';
import { Icon } from '../icons/Icon';

interface SnapshotRequest {
  /** Tells a newer request's picture from an older one's. */
  readonly id: number;
  readonly from: string;
  /** Their seat: a card picked out here can be kept track of there. */
  readonly seat: SeatIndex;
  /** How this player's video is turned on our screen, so the picture is the same way up. */
  readonly rotation: 0 | 180;
}

export type Identification =
  { readonly status: 'working' } | { readonly status: 'done'; readonly guesses: readonly CardGuess[] };

export type SnapshotState =
  | (SnapshotRequest & { readonly status: 'loading' })
  | (SnapshotRequest & { readonly status: 'ready'; readonly image: string; readonly identification: Identification })
  | (SnapshotRequest & { readonly status: 'failed'; readonly message: string });

interface SnapshotViewProps {
  readonly snapshot: SnapshotState;
  /** Shows a card in the Cards panel. */
  onOpenCard(cardId: string): void;
  /** Keeps track of the card (its counters, tapped or not) on their side of the table. Not when watching. */
  onTrack?: (card: Card, seat: SeatIndex) => void;
  /** Opens the Cards panel to search. */
  onSearch(): void;
  onClose(): void;
}

/** A sharp picture of a card on another player's table, and which card it probably is. */
export function SnapshotView({ snapshot, onOpenCard, onTrack, onSearch, onClose }: SnapshotViewProps) {
  return (
    <div className="overlay" role="dialog" aria-label={`From ${snapshot.from}'s camera`} onClick={onClose}>
      <div className="panel snapshot-panel" data-testid="snapshot" onClick={(event) => event.stopPropagation()}>
        <header className="panel-header">
          <h2>
            <Icon name="spyglass" /> From {snapshot.from}'s camera
          </h2>
          <button onClick={onClose}>Close</button>
        </header>
        {snapshot.status === 'loading' && <p className="hint">Asking their camera for a sharp picture…</p>}
        {snapshot.status === 'failed' && <p className="status status-reconnecting">{snapshot.message}</p>}
        {snapshot.status === 'ready' && (
          <div className="snapshot-body">
            <img
              className="snapshot-image"
              src={snapshot.image}
              alt="Close-up"
              style={snapshot.rotation ? { transform: `rotate(${snapshot.rotation}deg)` } : undefined}
            />
            <Guesses
              identification={snapshot.identification}
              onOpenCard={onOpenCard}
              onTrack={onTrack ? (card) => onTrack(card, snapshot.seat) : undefined}
              onSearch={onSearch}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function Guesses({
  identification,
  onOpenCard,
  onTrack,
  onSearch,
}: {
  readonly identification: Identification;
  onOpenCard(cardId: string): void;
  onTrack: ((card: Card) => void) | undefined;
  onSearch(): void;
}) {
  if (identification.status === 'working') {
    return <p className="hint snapshot-guesses">Working out which card this is…</p>;
  }
  const { guesses } = identification;
  return (
    <section className="snapshot-guesses" data-testid="snapshot-guesses" aria-label="Which card it is">
      {guesses.length === 0 ? (
        <p className="hint">Couldn't tell which card this is.</p>
      ) : (
        <>
          <h3>{guesses[0]!.score >= LIKELY ? 'It looks like' : 'Maybe one of these'}</h3>
          <ul className="guess-list">
            {guesses.map((guess) => (
              <li key={guess.card.id} className="guess-row">
                <button className="guess" onClick={() => onOpenCard(guess.card.id)} title={describe(guess)}>
                  {guess.card.image && (
                    <img className="guess-image" src={cardImageUrl(guess.card.image, 'small')} alt="" loading="lazy" />
                  )}
                  <span className="guess-name">{guess.card.name}</span>
                  <span className="hint">{describe(guess)}</span>
                </button>
                {onTrack && (
                  <button
                    className="guess-track"
                    title="Keep track of its counters and whether it's tapped"
                    aria-label={`Track ${guess.card.name}`}
                    onClick={() => onTrack(guess.card)}
                  >
                    Track
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      <button onClick={onSearch}>{guesses.length === 0 ? 'Search for it' : 'None of these: search'}</button>
    </section>
  );
}

/** A guess this good is very likely right. */
const LIKELY = 0.6;

function describe(guess: CardGuess): string {
  return guess.score >= LIKELY ? 'Likely' : guess.score >= 0.3 ? 'Possibly' : 'Unsure';
}
