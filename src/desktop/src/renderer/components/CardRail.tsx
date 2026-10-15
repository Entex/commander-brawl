import type { Card, SeatIndex } from '@commander-brawl/domain';
import { cardImageUrl } from '@commander-brawl/infrastructure/browser';
import { useEffect, useState } from 'react';
import { Icon } from '../icons/Icon';
import { seatColorClass } from '../seatColors';
import { LIKELY, lookupCard, type CardLookup, type LookupPicture } from '../useCardLookups';

interface CardRailProps {
  /** Newest first. */
  readonly lookups: readonly CardLookup[];
  /** Shows a card in the Cards panel: its text and rulings. */
  onOpenCard(cardId: string): void;
  /** Puts the card on its player's battlefield, where it was clicked. Not when watching. */
  onTrack?: (lookup: CardLookup, card: Card) => void;
  /** The player says which card a lookup is. */
  onChoose(lookupId: number, card: Card): void;
  /** Search for the card a lookup is, when none of the guesses is it. */
  onSearch(lookupId: number): void;
  /** Takes these out of the list. */
  onRemove(lookupIds: readonly number[]): void;
  onClose(): void;
}

/** Other guesses offered to pick instead. */
const MAX_OTHERS = 4;

/**
 * The cards clicked on the players' videos, beside the table: the latest one big, with which card it
 * probably is and the other guesses to pick instead, and the earlier ones below. With cards from more than one
 * player, it can show just one player's.
 */
export function CardRail({ lookups, onOpenCard, onTrack, onChoose, onSearch, onRemove, onClose }: CardRailProps) {
  const now = useNow(30_000);
  const [picked, setPicked] = useState<number | null>(null);
  const [only, setOnly] = useState<SeatIndex | null>(null);
  // A new card clicked: that's the one to show.
  const newest = lookups[0]?.id;
  const [shownNewest, setShownNewest] = useState(newest);
  if (newest !== shownNewest) {
    setShownNewest(newest);
    setPicked(null);
  }
  const players = playersIn(lookups);
  // Back to everyone's once none of that player's are left.
  const filter = only !== null && players.some((p) => p.seat === only) ? only : null;
  const shown = filter === null ? lookups : lookups.filter((lookup) => lookup.seat === filter);
  const featured = shown.find((lookup) => lookup.id === picked) ?? shown[0];
  if (!featured) return null;
  const earlier = shown.filter((lookup) => lookup !== featured);

  return (
    <aside className="card-rail" aria-label="Cards seen" data-testid="card-rail">
      <header className="card-rail-header">
        <h2>
          <Icon name="spyglass" /> Cards seen
        </h2>
        <button className="icon-button" onClick={onClose} aria-label="Hide cards seen" title="Hide">
          ✕
        </button>
      </header>
      {players.length > 1 && (
        <div className="card-rail-filter" role="group" aria-label="Whose cards">
          <button aria-pressed={filter === null} onClick={() => setOnly(null)}>
            All
          </button>
          {players.map((player) => (
            <button
              key={player.seat}
              className={seatColorClass(player.seat)}
              aria-pressed={filter === player.seat}
              onClick={() => setOnly(player.seat)}
            >
              {player.name}
            </button>
          ))}
        </div>
      )}
      <FeaturedLookup
        key={featured.id}
        lookup={featured}
        now={now}
        onOpenCard={onOpenCard}
        onTrack={onTrack}
        onChoose={onChoose}
        onSearch={onSearch}
        onRemove={() => onRemove([featured.id])}
      />
      {earlier.length > 0 && (
        <section className="card-rail-history" aria-label="Earlier">
          <header className="card-rail-history-header">
            <h3>Earlier</h3>
            <button className="link" onClick={() => onRemove(shown.map((lookup) => lookup.id))}>
              Remove all
            </button>
          </header>
          <ul>
            {earlier.map((lookup) => {
              const name = lookupCard(lookup)?.name ?? stepText(lookup);
              return (
                <li key={lookup.id} className={`lookup-item ${seatColorClass(lookup.seat)}`}>
                  <button className="lookup-row" onClick={() => setPicked(lookup.id)}>
                    <LookupThumb lookup={lookup} />
                    <span className="lookup-row-text">
                      <span className="lookup-row-name">{name}</span>
                      <span className="hint">
                        {lookup.own ? 'You' : lookup.from} · {ago(lookup.at, now)}
                      </span>
                    </span>
                  </button>
                  <button
                    className="icon-button lookup-remove"
                    aria-label={`Remove ${name}`}
                    title="Remove from the list"
                    onClick={() => onRemove([lookup.id])}
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </aside>
  );
}

/** The players whose cards are in the list, in seat order: "You" for your own camera. */
function playersIn(lookups: readonly CardLookup[]): { readonly seat: SeatIndex; readonly name: string }[] {
  const bySeat = new Map<SeatIndex, string>();
  for (const lookup of lookups) if (!bySeat.has(lookup.seat)) bySeat.set(lookup.seat, lookup.own ? 'You' : lookup.from);
  return [...bySeat].sort(([a], [b]) => a - b).map(([seat, name]) => ({ seat, name }));
}

function FeaturedLookup({
  lookup,
  now,
  onOpenCard,
  onTrack,
  onChoose,
  onSearch,
  onRemove,
}: {
  readonly lookup: CardLookup;
  readonly now: number;
  onOpenCard(cardId: string): void;
  onTrack: ((lookup: CardLookup, card: Card) => void) | undefined;
  onChoose(lookupId: number, card: Card): void;
  onSearch(lookupId: number): void;
  onRemove(): void;
}) {
  const { step } = lookup;
  const card = lookupCard(lookup);
  const picture = step.status === 'reading' || step.status === 'done' ? step.picture : null;
  // Scryfall's picture of the card over what their camera saw, once it's there (not at all offline).
  const [loadedImage, setLoadedImage] = useState<string | null>(null);
  const [brokenImage, setBrokenImage] = useState<string | null>(null);
  const cardImage = card?.image && card.image !== brokenImage ? card.image : null;
  const cardShown = cardImage !== null && cardImage === loadedImage;
  const [peeking, setPeeking] = useState(false);
  const peek = {
    onPointerEnter: () => setPeeking(true),
    onPointerLeave: () => setPeeking(false),
    onFocus: () => setPeeking(true),
    onBlur: () => setPeeking(false),
  };

  const others =
    step.status === 'done'
      ? step.guesses
          .map((guess) => guess.card)
          .filter((other) => other.id !== card?.id)
          .slice(0, MAX_OTHERS)
      : [];

  return (
    <article
      className={`lookup lookup-${step.status} ${seatColorClass(lookup.seat)}`}
      data-testid="lookup"
      data-status={step.status}
      aria-label={card ? card.name : stepText(lookup)}
    >
      <div className="lookup-frame">
        {picture && <Photo picture={picture} lookup={lookup} className="lookup-photo" />}
        {cardImage && (
          <img
            className={`lookup-card-image${cardShown && !peeking ? ' lookup-card-image-shown' : ''}`}
            src={cardImageUrl(cardImage, 'normal')}
            alt={card!.name}
            onLoad={() => setLoadedImage(cardImage)}
            onError={() => setBrokenImage(cardImage)}
          />
        )}
        {step.status === 'asking' && (
          <div className="lookup-placeholder">
            <Icon name="spyglass" />
            Asking {cameraOf(lookup)} for a sharp picture…
          </div>
        )}
        {step.status === 'failed' && (
          <div className="lookup-placeholder lookup-placeholder-failed">
            <Icon name="hazard-sign" />
            {step.message}
          </div>
        )}
        {step.status === 'reading' && <div className="lookup-scan" aria-hidden="true" />}
        {cardShown && picture && (
          <button
            className="lookup-peek"
            aria-label={`What ${cameraOf(lookup)} saw`}
            title={`What ${cameraOf(lookup)} saw`}
            {...peek}
          >
            <Photo picture={picture} lookup={lookup} />
          </button>
        )}
      </div>

      <header className="lookup-heading">
        <div className="lookup-title">
          <h3 className="lookup-name" data-testid="lookup-name">
            {card ? card.name : stepText(lookup)}
          </h3>
          <button
            className="icon-button lookup-remove"
            aria-label={`Remove ${card ? card.name : 'this card'}`}
            title="Remove from the list"
            onClick={onRemove}
          >
            ✕
          </button>
        </div>
        <p className="lookup-meta">
          {step.status === 'done' && <Confidence lookup={lookup} />}
          <span>
            {lookup.own ? 'Your camera' : `${lookup.from}'s camera`} · {ago(lookup.at, now)}
          </span>
        </p>
      </header>

      {card && (
        <div className="lookup-actions">
          <button className="primary" onClick={() => onOpenCard(card.id)}>
            <Icon name="spell-book" /> Details
          </button>
          {onTrack && (
            <button
              disabled={lookup.placed !== null}
              onClick={() => onTrack(lookup, card)}
              title="Shown on their video, with its counters and whether it's tapped"
              aria-label={lookup.placed ? `${card.name} is on the battlefield` : `Put ${card.name} on the battlefield`}
            >
              <Icon name="pin" /> {lookup.placed ? 'On the battlefield' : 'Put on the battlefield'}
            </button>
          )}
        </div>
      )}

      {step.status === 'done' && (
        <div className="lookup-others" data-testid="lookup-others">
          <span className="hint">{card ? 'Not it?' : 'Which card is it?'}</span>
          {others.map((other) => (
            <button
              key={other.id}
              className="chip-button"
              onClick={() => onChoose(lookup.id, other)}
              title={`It's ${other.name}`}
            >
              {other.name}
            </button>
          ))}
          <button className="chip-button" onClick={() => onSearch(lookup.id)}>
            <Icon name="spell-book" /> Search…
          </button>
        </div>
      )}
    </article>
  );
}

/** What their camera saw. Straightened, it's upright; otherwise it's turned like their video on our screen. */
function Photo({
  picture,
  lookup,
  className,
}: {
  readonly picture: LookupPicture;
  readonly lookup: CardLookup;
  readonly className?: string;
}) {
  return (
    <img
      className={className}
      src={picture.url}
      alt={lookup.own ? 'Your camera' : `${lookup.from}'s camera`}
      style={!picture.straight && lookup.rotation ? { transform: `rotate(${lookup.rotation}deg)` } : undefined}
    />
  );
}

function LookupThumb({ lookup }: { readonly lookup: CardLookup }) {
  const card = lookupCard(lookup);
  const [broken, setBroken] = useState(false);
  const picture = lookup.step.status === 'reading' || lookup.step.status === 'done' ? lookup.step.picture : null;
  return (
    <span className="lookup-row-thumb">
      {card?.image && !broken ? (
        <img src={cardImageUrl(card.image, 'small')} alt="" loading="lazy" onError={() => setBroken(true)} />
      ) : picture ? (
        <img src={picture.url} alt="" />
      ) : (
        <Icon name={lookup.step.status === 'failed' ? 'hazard-sign' : 'spyglass'} />
      )}
    </span>
  );
}

function Confidence({ lookup }: { readonly lookup: CardLookup }) {
  if (lookup.chosen) return <span className="confidence confidence-picked">Your pick</span>;
  const score = lookup.step.status === 'done' ? (lookup.step.guesses[0]?.score ?? 0) : 0;
  if (score === 0) return null;
  const [level, label] =
    score >= LIKELY ? ['likely', 'Likely'] : score >= 0.3 ? ['possibly', 'Possibly'] : ['unsure', 'Unsure'];
  return <span className={`confidence confidence-${level}`}>{label}</span>;
}

/** Whose camera, in a sentence: "your camera" or "Alex's camera". */
function cameraOf(lookup: CardLookup): string {
  return lookup.own ? 'your camera' : `${lookup.from}'s camera`;
}

/** What a lookup without a card is doing. */
function stepText(lookup: CardLookup): string {
  switch (lookup.step.status) {
    case 'asking':
      return 'Taking a picture…';
    case 'reading':
      return 'Reading the card…';
    case 'failed':
      return 'No picture';
    case 'done':
      return "Couldn't tell which card";
  }
}

function ago(at: number, now: number): string {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** The time, updated every so often. */
function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}
