import {
  MAX_GRAVEYARD,
  normalizeCardName,
  type GameState,
  type GraveCard,
  type SeatIndex,
} from '@commander-brawl/domain';
import { cardImageUrl } from '@commander-brawl/infrastructure/browser';
import { useState } from 'react';
import { Icon } from '../icons/Icon';
import { seatName, type Players } from '../names';
import { seatColorClass } from '../seatColors';
import { useCardsById } from '../useCards';
import { submitGameEvent } from '../useGame';
import { useCardSearch } from './AddToBattlefield';

interface GraveyardPanelProps {
  readonly seat: SeatIndex;
  readonly game: GameState;
  readonly players: Players;
  /** Watching: looking only. */
  readonly readOnly: boolean;
  onOpenCard(cardId: string): void;
  onClose(): void;
}

/**
 * A player's graveyard, as far as the table knows: searched by name or type ("creature"), each card opened in Cards,
 * returned to the battlefield or taken out. Cards can be put in by hand, not only from the battlefield.
 */
export function GraveyardPanel({ seat, game, players, readOnly, onOpenCard, onClose }: GraveyardPanelProps) {
  const cards = game.seats[seat]?.graveyard ?? [];
  const known = useCardsById(cards.flatMap((card) => (card.cardId ? [card.cardId] : [])));
  const [query, setQuery] = useState('');
  const words = normalizeCardName(query).split(' ').filter(Boolean);
  const shown = cards.filter((card) => {
    if (words.length === 0) return true;
    const typeLine = card.cardId ? (known.get(card.cardId)?.typeLine ?? '') : '';
    const haystack = normalizeCardName(`${card.name} ${typeLine}`);
    return words.every((word) => haystack.includes(word));
  });
  const name = seatName(players, seat);
  return (
    <div className="overlay" role="dialog" aria-label={`${name}'s graveyard`} onClick={onClose}>
      <div className={`panel graveyard-panel ${seatColorClass(seat)}`} onClick={(event) => event.stopPropagation()}>
        <header className="panel-header">
          <h2>
            <Icon name="graveyard" /> {name}'s graveyard ({cards.length})
          </h2>
          <button onClick={onClose}>Close</button>
        </header>
        <p className="hint">Only the cards someone put here: it may not be all of it.</p>
        <input
          value={query}
          placeholder="Search by name or type: creature, instant…"
          aria-label="Search the graveyard"
          onChange={(event) => setQuery(event.target.value)}
        />
        <ul className="graveyard-list" data-testid="graveyard-list">
          {shown.map((card) => (
            <GraveRow
              key={card.id}
              seat={seat}
              card={card}
              image={card.cardId ? (known.get(card.cardId)?.image ?? null) : null}
              typeLine={card.cardId ? (known.get(card.cardId)?.typeLine ?? '') : ''}
              readOnly={readOnly}
              onOpenCard={onOpenCard}
            />
          ))}
        </ul>
        {cards.length === 0 && <p className="hint">Nothing here yet.</p>}
        {cards.length > 0 && shown.length === 0 && <p className="hint">No card here matches that.</p>}
        {!readOnly && cards.length < MAX_GRAVEYARD && <AddToGraveyard seat={seat} />}
      </div>
    </div>
  );
}

function GraveRow({
  seat,
  card,
  image,
  typeLine,
  readOnly,
  onOpenCard,
}: {
  readonly seat: SeatIndex;
  readonly card: GraveCard;
  readonly image: string | null;
  readonly typeLine: string;
  readonly readOnly: boolean;
  onOpenCard(cardId: string): void;
}) {
  const take = (returned: boolean) =>
    submitGameEvent({ type: 'graveyard-card-removed', seat, id: card.id, name: card.name, returned });
  return (
    <li>
      <span className="graveyard-thumb">
        {image ? <img src={cardImageUrl(image, 'small')} alt="" loading="lazy" /> : <Icon name="card-play" />}
      </span>
      <span className="graveyard-text">
        {card.cardId ? (
          <button className="link" onClick={() => onOpenCard(card.cardId!)}>
            {card.name}
          </button>
        ) : (
          <b>{card.name}</b>
        )}
        {typeLine && <span className="hint">{typeLine}</span>}
      </span>
      {!readOnly && (
        <>
          <button onClick={() => take(true)} title="Back onto the battlefield" aria-label={`Return ${card.name}`}>
            Return
          </button>
          <button className="link danger" onClick={() => take(false)} aria-label={`Take ${card.name} out`}>
            ✕
          </button>
        </>
      )}
    </li>
  );
}

/** A card put in the graveyard by hand: not every card that dies was looked at first. */
function AddToGraveyard({ seat }: { readonly seat: SeatIndex }) {
  const [query, setQuery] = useState('');
  const typed = query.trim();
  const found = useCardSearch(typed).slice(0, 6);
  const add = (name: string, cardId: string | null) => {
    submitGameEvent({ type: 'card-to-graveyard', seat, card: { id: crypto.randomUUID(), name, cardId } });
    setQuery('');
  };
  return (
    <div className="graveyard-add">
      <input
        value={query}
        placeholder="Put a card in by name…"
        aria-label="Put a card in the graveyard"
        onChange={(event) => setQuery(event.target.value)}
      />
      {typed.length >= 2 && (
        <div className="add-board-choices">
          {found.map((card) => (
            <button key={card.id} onClick={() => add(card.name, card.id)}>
              {card.name}
            </button>
          ))}
          <button onClick={() => add(typed, null)}>“{typed}”</button>
        </div>
      )}
    </div>
  );
}
