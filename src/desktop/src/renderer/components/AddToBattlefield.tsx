import {
  MAX_MARKERS,
  MAX_NOTE_LENGTH,
  MAX_PERMANENTS,
  MAX_TOKENS_IN_GROUP,
  NOTE,
  type Card,
  type GameState,
  type SeatIndex,
  type Spot,
} from '@commander-brawl/domain';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { Icon } from '../icons/Icon';
import type { Players } from '../names';
import { submitGameEvent } from '../useGame';
import { counterKinds } from './Battlefield';
import { RemindersPanel } from './Reminders';

type View = 'menu' | 'token' | 'card' | 'counter' | 'note' | 'reminder';

/** Notes that come up a lot. */
const NOTES = ['Attacking', 'Blocking', 'Goaded', 'Summoning sick', 'Phased out', 'Face down'];

interface AddToBattlefieldProps {
  readonly seat: SeatIndex;
  /** "Alex's", "your". */
  readonly whose: string;
  readonly game: GameState;
  readonly players: Players;
  readonly selfSeat: SeatIndex | null;
  /** The spot on the player's picture it goes, if one was clicked; otherwise one beside what's there. */
  readonly spot: Spot | null;
  /** Where the menu opens, in the seat (pixels from its top left). */
  readonly at: { readonly x: number; readonly y: number } | null;
  onClose(): void;
}

/**
 * Adding to a player's battlefield, from their seat: a token (as a card on their video), a counter or a note on a
 * spot, a card, or a trigger reminder for their turns.
 */
export function AddToBattlefield({ seat, whose, game, players, selfSeat, spot, at, onClose }: AddToBattlefieldProps) {
  const [view, setView] = useState<View>('menu');
  const state = game.seats[seat];
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  if (!state) return null;
  const where = spot ?? nextSpot(game, seat);
  const fullOfCards = state.permanents.length >= MAX_PERMANENTS;
  const fullOfMarkers = state.markers.length >= MAX_MARKERS;

  if (view === 'reminder') {
    return <RemindersPanel game={game} players={players} selfSeat={selfSeat} forSeats={[seat]} onClose={onClose} />;
  }

  return (
    <div
      className="add-board"
      role="dialog"
      aria-label={`Add to ${whose} battlefield`}
      style={at ? { left: at.x, top: at.y } : undefined}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <header className="add-board-header">
        <b>{view === 'menu' ? `Add to ${whose} battlefield` : VIEW_TITLES[view]}</b>
        <button className="icon-button" aria-label="Close" onClick={onClose}>
          ✕
        </button>
      </header>
      {view === 'menu' && (
        <div className="add-board-menu">
          <button disabled={fullOfCards} onClick={() => setView('token')}>
            <Icon name="token" /> Token
          </button>
          <button disabled={fullOfMarkers} onClick={() => setView('counter')}>
            <Icon name="abacus" /> Counter
          </button>
          <button disabled={fullOfMarkers} onClick={() => setView('note')}>
            <Icon name="pin" /> Note
          </button>
          <button disabled={fullOfCards} onClick={() => setView('card')}>
            <Icon name="card-play" /> Card
          </button>
          <button onClick={() => setView('reminder')}>
            <Icon name="ringing-bell" /> Reminder
          </button>
        </div>
      )}
      {(view === 'token' || view === 'card') && (
        <CardPicker
          tokens={view === 'token'}
          onPick={(name, card, count) => {
            submitGameEvent({
              type: 'permanent-added',
              seat,
              permanent: {
                id: crypto.randomUUID(),
                name,
                cardId: card?.id ?? null,
                token: view === 'token' || (card !== null && isToken(card)),
                count: view === 'token' ? count : 1,
                spot: where,
              },
            });
            onClose();
          }}
        />
      )}
      {view === 'counter' && (
        <div className="add-board-choices">
          {counterKinds(game).map((k) => (
            <button
              key={k.kind}
              onClick={() => {
                submitGameEvent({
                  type: 'marker-placed',
                  seat,
                  marker: { id: crypto.randomUUID(), spot: where, kind: k.kind, count: 1, text: '' },
                });
                onClose();
              }}
            >
              {k.name}
            </button>
          ))}
        </div>
      )}
      {view === 'note' && (
        <NotePicker
          onPick={(text) => {
            submitGameEvent({
              type: 'marker-placed',
              seat,
              marker: { id: crypto.randomUUID(), spot: where, kind: NOTE, count: 0, text },
            });
            onClose();
          }}
        />
      )}
    </div>
  );
}

const VIEW_TITLES: Record<Exclude<View, 'menu'>, string> = {
  token: 'Add tokens',
  card: 'Add a card',
  counter: 'Add counters',
  note: 'Add a note',
  reminder: 'Add a reminder',
};

/** Finds a card or token by name, or (for tokens) takes any name. */
function CardPicker({
  tokens,
  onPick,
}: {
  readonly tokens: boolean;
  onPick(name: string, card: Card | null, count: number): void;
}) {
  const [query, setQuery] = useState('');
  const [count, setCount] = useState(1);
  const typed = query.trim();
  const found = useCardSearch(typed);
  // Tokens first, when it's tokens being added.
  const results = tokens
    ? [...found.filter(isToken), ...found.filter((c) => !isToken(c))].slice(0, 6)
    : found.slice(0, 6);
  return (
    <div className="add-board-picker">
      <div className="row">
        <input
          // A small popup opened to type in: straight into the box.
          autoFocus
          value={query}
          placeholder={tokens ? 'Treasure, Goblin, Soldier…' : 'A card’s name…'}
          aria-label={tokens ? 'Token' : 'Card'}
          onChange={(event) => setQuery(event.target.value)}
        />
        {tokens && (
          <input
            type="number"
            min={1}
            max={MAX_TOKENS_IN_GROUP}
            value={count}
            aria-label="How many tokens"
            onChange={(event) => setCount(Math.max(1, Math.min(MAX_TOKENS_IN_GROUP, event.target.valueAsNumber || 1)))}
          />
        )}
      </div>
      {typed.length >= 2 && (
        <div className="add-board-choices">
          {results.map((card) => (
            <button key={card.id} onClick={() => onPick(card.name, card, count)}>
              {card.name}
            </button>
          ))}
          {tokens && <button onClick={() => onPick(typed, null, count)}>“{typed}”</button>}
        </div>
      )}
    </div>
  );
}

function NotePicker({ onPick }: { onPick(text: string): void }) {
  const [text, setText] = useState('');
  return (
    <form
      className="add-board-picker"
      onSubmit={(event) => {
        event.preventDefault();
        if (text.trim()) onPick(text.trim());
      }}
    >
      <div className="add-board-choices">
        {NOTES.map((note) => (
          <button key={note} type="button" onClick={() => onPick(note)}>
            {note}
          </button>
        ))}
      </div>
      <div className="row">
        <input
          autoFocus
          value={text}
          maxLength={MAX_NOTE_LENGTH}
          placeholder="Or your own words"
          aria-label="Note"
          onChange={(event) => setText(event.target.value)}
        />
        <button type="submit" disabled={!text.trim()}>
          Add
        </button>
      </div>
    </form>
  );
}

/** Cards whose names match what's typed (two letters or more), a moment after typing stops. */
function useCardSearch(typed: string): readonly Card[] {
  const [found, setFound] = useState<{ readonly query: string; readonly cards: readonly Card[] }>({
    query: '',
    cards: [],
  });
  useEffect(() => {
    if (typed.length < 2) return;
    let active = true;
    const timer = setTimeout(() => {
      void api.cards.search(typed).then((cards) => {
        if (active) setFound({ query: typed, cards });
      });
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [typed]);
  return found.query === typed && typed.length >= 2 ? found.cards : [];
}

export function isToken(card: Card): boolean {
  return card.layout === 'token' || card.layout === 'double_faced_token' || card.typeLine.startsWith('Token');
}

/** A spot for something added without one clicked: low on the picture, beside what's there. */
function nextSpot(game: GameState, seat: SeatIndex): Spot {
  const state = game.seats[seat];
  const n = (state?.permanents.filter((p) => p.spot).length ?? 0) + (state?.markers.length ?? 0);
  return { x: 0.2 + (n % 4) * 0.2, y: 0.72 - (Math.floor(n / 4) % 4) * 0.14 };
}
