import {
  MAX_PERMANENTS,
  MAX_TOKENS_IN_GROUP,
  PERMANENT_COUNTERS,
  type Card,
  type GameState,
  type Permanent,
  type SeatIndex,
} from '@commander-brawl/domain';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { CUSTOM_KIND_PREFIX, counterKindName } from '../names';
import { submitGameEvent } from '../useGame';

interface PermanentsProps {
  readonly seat: SeatIndex;
  readonly game: GameState;
  onOpenCard(cardId: string): void;
}

/** Cards with counters on them and groups of tokens, in a player's details. */
export function PermanentsSection({ seat, game, onOpenCard }: PermanentsProps) {
  const permanents = game.seats[seat]?.permanents ?? [];
  return (
    <section data-testid="permanents">
      <h4>On the battlefield</h4>
      {permanents.length === 0 && <p className="hint">Keep track of counters on a card, or of a group of tokens.</p>}
      {permanents.map((permanent) => (
        <PermanentRow key={permanent.id} seat={seat} permanent={permanent} game={game} onOpenCard={onOpenCard} />
      ))}
      {permanents.length < MAX_PERMANENTS && <AddPermanent seat={seat} />}
    </section>
  );
}

function PermanentRow({
  seat,
  permanent,
  game,
  onOpenCard,
}: {
  readonly seat: SeatIndex;
  readonly permanent: Permanent;
  readonly game: GameState;
  onOpenCard(cardId: string): void;
}) {
  const { id, name, token, count, tapped, counters } = permanent;
  const change = (type: 'permanent-count-changed' | 'permanent-tapped', amount: number) =>
    submitGameEvent({ type, seat, id, amount });
  const kinds = [
    ...PERMANENT_COUNTERS.map((kind) => ({ kind, name: kind })),
    ...game.customCounters
      .filter((counter) => counter.scope === 'card')
      .map((counter) => ({ kind: `${CUSTOM_KIND_PREFIX}${counter.id}`, name: counter.name })),
  ].filter((k) => !(k.kind in counters));

  return (
    <div className={`permanent${tapped === count ? ' permanent-tapped' : ''}`} data-testid={`permanent-${name}`}>
      <div className="permanent-head">
        {permanent.cardId ? (
          <button className="link permanent-name" onClick={() => onOpenCard(permanent.cardId!)}>
            {name}
          </button>
        ) : (
          <span className="permanent-name">{name}</span>
        )}
        {token && (
          <span className="permanent-count">
            <button
              aria-label={`One ${name} token fewer`}
              disabled={count <= 1}
              onClick={() => change('permanent-count-changed', -1)}
            >
              −
            </button>
            <b>{count}</b>
            <button
              aria-label={`One more ${name} token`}
              disabled={count >= MAX_TOKENS_IN_GROUP}
              onClick={() => change('permanent-count-changed', 1)}
            >
              +
            </button>
            <span className="hint">tokens</span>
          </span>
        )}
        {count === 1 ? (
          <button aria-pressed={tapped === 1} onClick={() => change('permanent-tapped', tapped === 1 ? -1 : 1)}>
            {tapped === 1 ? 'Tapped' : 'Untapped'}
          </button>
        ) : (
          <span className="permanent-count">
            <button
              aria-label={`Untap one ${name}`}
              disabled={tapped === 0}
              onClick={() => change('permanent-tapped', -1)}
            >
              −
            </button>
            <b>{tapped}</b>
            <button
              aria-label={`Tap one ${name}`}
              disabled={tapped >= count}
              onClick={() => change('permanent-tapped', 1)}
            >
              +
            </button>
            <span className="hint">tapped</span>
          </span>
        )}
        <button
          className="link danger"
          aria-label={`Remove ${name}`}
          onClick={() => submitGameEvent({ type: 'permanent-removed', seat, id })}
        >
          Remove
        </button>
      </div>
      <div className="permanent-counters">
        {Object.entries(counters).map(([kind, value]) => {
          const kindName = counterKindName(game, kind);
          const counter = (amount: number) =>
            submitGameEvent({ type: 'permanent-counter-changed', seat, id, kind, amount });
          return (
            <span key={kind} className="chip">
              {kindName}
              <button aria-label={`Remove a ${kindName} counter from ${name}`} onClick={() => counter(-1)}>
                −
              </button>
              <b>{value}</b>
              <button aria-label={`Add a ${kindName} counter to ${name}`} onClick={() => counter(1)}>
                +
              </button>
            </span>
          );
        })}
        <select
          aria-label={`Put a counter on ${name}`}
          value=""
          onChange={(event) =>
            event.target.value &&
            submitGameEvent({ type: 'permanent-counter-changed', seat, id, kind: event.target.value, amount: 1 })
          }
        >
          <option value="">+ Counter</option>
          {kinds.map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/** Finds a card or token by name (or takes any name, for a token), and adds it. */
function AddPermanent({ seat }: { readonly seat: SeatIndex }) {
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<{ readonly query: string; readonly cards: readonly Card[] }>({
    query: '',
    cards: [],
  });
  const [tokens, setTokens] = useState(1);
  const typed = query.trim();

  useEffect(() => {
    if (typed.length < 2) return;
    let active = true;
    const timer = setTimeout(() => {
      void api.cards.search(typed).then((cards) => {
        if (active) setFound({ query: typed, cards: cards.slice(0, 6) });
      });
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [typed]);

  const results = found.query === typed && typed.length >= 2 ? found.cards : [];
  const add = (name: string, cardId: string | null, token: boolean) => {
    submitGameEvent({
      type: 'permanent-added',
      seat,
      permanent: { id: crypto.randomUUID(), name, cardId, token, count: token ? tokens : 1 },
    });
    setQuery('');
  };

  return (
    <div className="add-permanent">
      <div className="row">
        <input
          value={query}
          placeholder="Add a card or token…"
          aria-label="Card or token to keep track of"
          onChange={(event) => setQuery(event.target.value)}
        />
        <label className="hint">
          Tokens{' '}
          <input
            type="number"
            min={1}
            max={MAX_TOKENS_IN_GROUP}
            value={tokens}
            aria-label="How many tokens"
            onChange={(event) => setTokens(Math.max(1, Math.min(MAX_TOKENS_IN_GROUP, event.target.valueAsNumber || 1)))}
          />
        </label>
      </div>
      {typed.length >= 2 && (
        <div className="add-permanent-choices">
          {results.map((card) => {
            const token = isToken(card);
            return (
              <button key={card.id} onClick={() => add(card.name, card.id, token)}>
                {card.name}
                {token ? ` (${tokens} token${tokens === 1 ? '' : 's'})` : ''}
              </button>
            );
          })}
          <button onClick={() => add(typed, null, true)}>
            “{typed}” as {tokens} token{tokens === 1 ? '' : 's'}
          </button>
        </div>
      )}
    </div>
  );
}

function isToken(card: Card): boolean {
  return card.layout === 'token' || card.layout === 'double_faced_token' || card.typeLine.startsWith('Token');
}

/** Short lines for the seat: "Atraxa: +1/+1 3", "Goblin ×5 (2 tapped)". */
export function permanentSummaries(game: GameState, permanents: readonly Permanent[]): { key: string; text: string }[] {
  return permanents
    .filter((p) => p.token || p.tapped > 0 || Object.keys(p.counters).length > 0)
    .map((p) => {
      const parts = [
        p.token ? `${p.name} ×${p.count}` : p.name,
        ...Object.entries(p.counters).map(([kind, value]) => `${counterKindName(game, kind)} ${value}`),
      ];
      const tapped = p.tapped === 0 ? '' : p.count === 1 ? ' (tapped)' : ` (${p.tapped} tapped)`;
      return { key: p.id, text: `${parts.join(', ')}${tapped}` };
    });
}
