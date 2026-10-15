import type { Card, CardFace } from '@commander-brawl/domain';
import { cardImageUrl } from '@commander-brawl/infrastructure/browser';
import { useEffect, useState, type ReactNode } from 'react';
import type { CardDataStatus, CardDetails } from '../../shared/api';
import { api } from '../api';
import { Icon } from '../icons/Icon';
import { keywordExplanation } from '../keywords';
import { CardText, Symbols } from './CardText';

interface CardsPanelProps {
  /** Show this card straight away, e.g. a commander someone clicked. */
  readonly initialCardId?: string | null;
  /** Puts a card in the spotlight for the whole table. Only at a table. */
  onSpotlight?: (card: Card, reason: 'cast' | 'show') => void;
  /** Searching for which card one clicked on a video is: the player picks it. */
  onPick?: (card: Card) => void;
  onClose(): void;
}

/** Look up any card: what it does, what it looks like, and its official rulings. */
export function CardsPanel({ initialCardId = null, onSpotlight, onPick, onClose }: CardsPanelProps) {
  const status = useCardStatus();
  const [query, setQuery] = useState('');
  const results = useSearch(query, status);
  const [picked, setPicked] = useState<string | null>(initialCardId);
  const [highlighted, setHighlighted] = useState(0);
  const selected = picked ?? results[0]?.id ?? null;
  const details = useDetails(selected);

  const pick = (index: number) => {
    const card = results[index];
    if (!card) return;
    setHighlighted(index);
    setPicked(card.id);
  };

  return (
    <aside className="side-panel cards-panel" aria-label="Cards" data-testid="cards-panel">
      <header className="panel-header">
        <h2>
          <Icon name="spell-book" /> {onPick ? 'Which card is it?' : 'Cards'}
        </h2>
        <button onClick={onClose}>Close</button>
      </header>
      <input
        autoFocus
        aria-label="Search for a card"
        placeholder="Search for a card, e.g. rhystic"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setPicked(null);
          setHighlighted(0);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') pick(Math.min(highlighted + 1, results.length - 1));
          if (event.key === 'ArrowUp') pick(Math.max(highlighted - 1, 0));
          if (event.key === 'Escape') onClose();
        }}
      />
      <StatusLine status={status} />
      <div className="cards-body">
        <ul className="card-results" aria-label="Results">
          {results.map((card, index) => (
            <li key={card.id}>
              <button aria-current={card.id === selected} onClick={() => pick(index)}>
                <span className="card-result-name">{card.name}</span>
                <span className="card-result-cost">
                  <Symbols text={card.manaCost} />
                </span>
              </button>
            </li>
          ))}
          {query.trim() && results.length === 0 && status.state === 'ready' && (
            <li className="hint">No card by that name.</li>
          )}
        </ul>
        {details && (
          <CardView
            key={details.card.id}
            details={details}
            actions={
              onPick ? (
                <div className="row card-actions">
                  <button className="primary" onClick={() => onPick(details.card)}>
                    It's this card
                  </button>
                </div>
              ) : (
                onSpotlight && (
                  <div className="row card-actions">
                    <button className="primary" onClick={() => onSpotlight(details.card, 'cast')}>
                      Cast it
                    </button>
                    <button onClick={() => onSpotlight(details.card, 'show')}>Show everyone</button>
                  </div>
                )
              )
            }
          />
        )}
      </div>
      <footer className="hint">
        Card data and pictures from{' '}
        <a href="https://scryfall.com" target="_blank" rel="noreferrer">
          Scryfall
        </a>
        .
      </footer>
    </aside>
  );
}

export function CardView({ details, actions }: { readonly details: CardDetails; readonly actions?: ReactNode }) {
  const { card, rulings } = details;
  const faces: readonly (Card | CardFace)[] = card.faces.length > 0 ? card.faces : [card];
  const images = card.faces.map((f) => f.image).filter((i): i is string => i !== null);
  const [shownImage, setShownImage] = useState(0);
  const image = images[shownImage] ?? card.image;

  return (
    <article className="card-view" data-testid="card-view">
      {image && (
        <img
          className="card-image"
          src={cardImageUrl(image, 'normal')}
          alt={card.name}
          title={images.length > 1 ? 'Click to see the other side' : undefined}
          onClick={() => setShownImage((shownImage + 1) % Math.max(images.length, 1))}
        />
      )}
      <div className="card-info">
        {actions}
        <div className="card-badges">
          {card.gameChanger && (
            <span className="badge badge-warn" title="On Wizards' Game Changers list for Commander brackets">
              Game Changer
            </span>
          )}
          {card.commander === 'banned' && <span className="badge badge-error">Banned in Commander</span>}
        </div>
        {faces.map((face) => (
          <section key={face.name} className="card-face">
            <h3>
              {face.name} <Symbols text={face.manaCost} />
            </h3>
            <p className="card-type">{face.typeLine}</p>
            <CardText className="card-oracle" text={face.oracleText} keywords={card.keywords} />
            {face.stats && <p className="card-stats">{face.stats}</p>}
          </section>
        ))}
        <Keywords keywords={card.keywords} />
        {rulings.length > 0 && (
          <section className="card-rulings">
            <h4>Rulings</h4>
            <ul>
              {rulings.map((ruling, index) => (
                <li key={index}>
                  <time>{ruling.date}</time> <CardText text={ruling.text} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </article>
  );
}

/** What the card's keywords mean, the ones the app can explain. */
function Keywords({ keywords }: { readonly keywords: readonly string[] }) {
  const explained = keywords.flatMap((keyword) => {
    const meaning = keywordExplanation(keyword);
    return meaning ? [{ keyword, meaning }] : [];
  });
  if (explained.length === 0) return null;
  return (
    <section className="card-keywords" data-testid="card-keywords">
      <h4>Keywords</h4>
      <dl>
        {explained.map(({ keyword, meaning }) => (
          <div key={keyword}>
            <dt>{keyword}</dt>
            <dd>{meaning}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function StatusLine({ status }: { readonly status: CardDataStatus }) {
  switch (status.state) {
    case 'ready':
      return null;
    case 'missing':
      return <p className="hint">Getting the cards ready…</p>;
    case 'downloading':
      return (
        <p className="hint" data-testid="cards-progress">
          Downloading the cards from Scryfall: {Math.round(status.progress * 100)}%
        </p>
      );
    case 'error':
      return (
        <p className="status status-reconnecting">
          {status.count > 0 ? 'Could not update the cards' : 'Could not download the cards'}: {status.message}{' '}
          <button className="link" onClick={() => void api.cards.refresh()}>
            Try again
          </button>
        </p>
      );
  }
}

function useCardStatus(): CardDataStatus {
  const [status, setStatus] = useState<CardDataStatus>({ state: 'missing' });
  useEffect(() => {
    let active = true;
    const off = api.cards.onStatus((next) => {
      if (active) setStatus(next);
    });
    void api.cards.status().then((initial) => {
      if (active) setStatus(initial);
    });
    return () => {
      active = false;
      off();
    };
  }, []);
  return status;
}

/** Searches as you type, waiting for a short pause so each keystroke doesn't start a search. */
function useSearch(query: string, status: CardDataStatus): readonly Card[] {
  const [results, setResults] = useState<readonly Card[]>([]);
  const ready = status.state === 'ready' || (status.state === 'error' && status.count > 0);
  useEffect(() => {
    if (!query.trim() || !ready) return;
    let active = true;
    const timer = setTimeout(() => {
      void api.cards.search(query).then((found) => {
        if (active) setResults(found);
      });
    }, 120);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, ready]);
  return query.trim() ? results : [];
}

export function useDetails(id: string | null): CardDetails | null {
  const [details, setDetails] = useState<CardDetails | null>(null);
  useEffect(() => {
    if (!id) return;
    let active = true;
    void api.cards.details(id).then((found) => {
      if (active) setDetails(found);
    });
    return () => {
      active = false;
    };
  }, [id]);
  return id && details?.card.id === id ? details : null;
}
