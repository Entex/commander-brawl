import type { Card } from '@commander-brawl/domain';
import { cardImageUrl } from '@commander-brawl/infrastructure/browser';
import { useEffect, useState } from 'react';
import { Icon } from '../icons/Icon';
import { seatColorClass } from '../seatColors';
import { lookupCard, type CardLookup, type LookupPicture } from '../useCardLookups';

interface CardRailProps {
  /** Newest first. */
  readonly lookups: readonly CardLookup[];
  /** Shows a card in the Cards panel: its text and rulings. */
  onOpenCard(cardId: string): void;
  /** Keeps track of the card (its counters, tapped or not) on its player's side. Not when watching. */
  onTrack?: (lookup: CardLookup, card: Card) => void;
  /** The player says which card a lookup is. */
  onChoose(lookupId: number, card: Card): void;
  /** Search for the card a lookup is, when none of the guesses is it. */
  onSearch(lookupId: number): void;
  onClear(): void;
  onClose(): void;
}

/** A guess this good is very likely right. */
const LIKELY = 0.6;
/** Other guesses offered to pick instead. */
const MAX_OTHERS = 4;

/**
 * The cards clicked on the players' videos, beside the table: the latest one big, with which card it
 * probably is and the other guesses to pick instead, and the earlier ones below.
 */
export function CardRail({ lookups, onOpenCard, onTrack, onChoose, onSearch, onClear, onClose }: CardRailProps) {
  const now = useNow(30_000);
  const [picked, setPicked] = useState<number | null>(null);
  // A new card clicked: that's the one to show.
  const newest = lookups[0]?.id;
  const [shownNewest, setShownNewest] = useState(newest);
  if (newest !== shownNewest) {
    setShownNewest(newest);
    setPicked(null);
  }
  const featured = lookups.find((lookup) => lookup.id === picked) ?? lookups[0];
  if (!featured) return null;
  const earlier = lookups.filter((lookup) => lookup !== featured);

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
      <FeaturedLookup
        key={featured.id}
        lookup={featured}
        now={now}
        onOpenCard={onOpenCard}
        onTrack={onTrack}
        onChoose={onChoose}
        onSearch={onSearch}
      />
      {earlier.length > 0 && (
        <section className="card-rail-history" aria-label="Earlier">
          <header className="card-rail-history-header">
            <h3>Earlier</h3>
            <button className="link" onClick={onClear}>
              Clear
            </button>
          </header>
          <ul>
            {earlier.map((lookup) => (
              <li key={lookup.id} className={seatColorClass(lookup.seat)}>
                <button className="lookup-row" onClick={() => setPicked(lookup.id)}>
                  <LookupThumb lookup={lookup} />
                  <span className="lookup-row-text">
                    <span className="lookup-row-name">{lookupCard(lookup)?.name ?? stepText(lookup)}</span>
                    <span className="hint">
                      {lookup.own ? 'You' : lookup.from} · {ago(lookup.at, now)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}

function FeaturedLookup({
  lookup,
  now,
  onOpenCard,
  onTrack,
  onChoose,
  onSearch,
}: {
  readonly lookup: CardLookup;
  readonly now: number;
  onOpenCard(cardId: string): void;
  onTrack: ((lookup: CardLookup, card: Card) => void) | undefined;
  onChoose(lookupId: number, card: Card): void;
  onSearch(lookupId: number): void;
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
        <h3 className="lookup-name" data-testid="lookup-name">
          {card ? card.name : stepText(lookup)}
        </h3>
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
              disabled={lookup.tracked}
              onClick={() => onTrack(lookup, card)}
              title="Keep track of its counters and whether it's tapped"
              aria-label={lookup.tracked ? `Tracking ${card.name}` : `Track ${card.name}`}
            >
              <Icon name="convergence-target" /> {lookup.tracked ? 'Tracking' : 'Track'}
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
