import type { GameView } from '@commander-brawl/application';
import { cardImageUrl } from '@commander-brawl/infrastructure/browser';
import { useEffect, useRef, useState } from 'react';
import { CardText } from './CardText';
import { useDetails } from './CardsPanel';

/** How long a card stays in the spotlight, unless the mouse is on it. */
const SHOW_FOR_MS = 12_000;

/** A card someone at the table cast or showed, big, for everyone, for a few seconds. */
export function Spotlight({ game }: { readonly game: GameView }) {
  const live = game.lastLive;
  const entry = live?.event.type === 'card-shown' ? live : null;
  const [dismissed, setDismissed] = useState(-1);
  const hovered = useRef(false);
  const visible = entry !== null && entry.seq > dismissed;
  const details = useDetails(visible && entry.event.type === 'card-shown' ? entry.event.card.id : null);

  useEffect(() => {
    if (!visible || !entry) return;
    const seq = entry.seq;
    const timer = setInterval(() => {
      if (!hovered.current) setDismissed((d) => Math.max(d, seq));
    }, SHOW_FOR_MS);
    return () => clearInterval(timer);
  }, [visible, entry]);

  if (!visible || entry.event.type !== 'card-shown') return null;
  const { card, reason } = entry.event;
  const front = details?.card.faces[0] ?? details?.card;

  return (
    <div
      className="spotlight"
      role="dialog"
      aria-label={`${entry.by.name} ${reason === 'cast' ? 'cast' : 'showed'} ${card.name}`}
      data-testid="spotlight"
      onMouseEnter={() => (hovered.current = true)}
      onMouseLeave={() => (hovered.current = false)}
    >
      <p className="spotlight-who">
        {entry.by.name} {reason === 'cast' ? 'cast' : 'showed'}
      </p>
      {details?.card.image ? (
        <img className="spotlight-image" src={cardImageUrl(details.card.image, 'large')} alt={card.name} />
      ) : (
        <h2>{card.name}</h2>
      )}
      {front && <CardText className="spotlight-text" text={front.oracleText} />}
      <button onClick={() => setDismissed(entry.seq)}>Close</button>
    </div>
  );
}
