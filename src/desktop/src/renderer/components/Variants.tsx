import type { GameView } from '@commander-brawl/application';
import {
  currentPlane,
  currentScheme,
  planeswalk,
  setSchemeInMotion,
  type Archenemy,
  type Card,
  type GameState,
  type Planechase,
  type SeatIndex,
  type VariantCard,
} from '@commander-brawl/domain';
import { cardImageUrl } from '@commander-brawl/infrastructure/browser';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { seatName, type Players } from '../names';
import { submitGameEvent } from '../useGame';
import { CardText } from './CardText';
import { useDetails } from './CardsPanel';
import { useFreshLive } from './ResponseCalls';

/** How long a new plane or scheme shows big for everyone. */
const SHOW_FOR_MS = 12_000;

interface VariantsPanelProps {
  readonly game: GameState;
  readonly players: Players;
  onClose(): void;
}

/** Planechase and Archenemy: started (usually before a game) and ended here. */
export function VariantsPanel({ game, players, onClose }: VariantsPanelProps) {
  const [planes, setPlanes] = useState<readonly Card[] | null>(null);
  const [schemes, setSchemes] = useState<readonly Card[] | null>(null);
  const [phenomena, setPhenomena] = useState(true);
  const self = players.find((p) => p.isSelf)?.player.seat ?? null;
  const [archenemy, setArchenemy] = useState<SeatIndex | null>(self);

  useEffect(() => {
    void api.cards.variantCards('planechase').then(setPlanes);
    void api.cards.variantCards('archenemy').then(setSchemes);
  }, []);

  const planarDeck: VariantCard[] = (planes ?? [])
    .filter((card) => phenomena || !card.typeLine.includes('Phenomenon'))
    .map((card) => ({ id: card.id, name: card.name }));
  const schemeDeck = (schemes ?? []).map((card) => ({
    id: card.id,
    name: card.name,
    ongoing: card.typeLine.includes('Ongoing'),
  }));

  return (
    <div className="overlay" role="dialog" aria-label="Planechase and Archenemy" onClick={onClose}>
      <div className="panel variants-panel" onClick={(event) => event.stopPropagation()}>
        <header className="panel-header">
          <h2>Planechase and Archenemy</h2>
          <button onClick={onClose}>Close</button>
        </header>

        <section>
          <h3>Planechase</h3>
          <p className="hint">One planar deck for the whole table, with every plane there is, shuffled.</p>
          {game.planechase ? (
            <div className="row">
              <span>On, with {game.planechase.deck.length} planes.</span>
              <button className="danger" onClick={() => submitGameEvent({ type: 'planechase-ended' })}>
                End Planechase
              </button>
            </div>
          ) : (
            <div className="row">
              <label>
                <input type="checkbox" checked={phenomena} onChange={(e) => setPhenomena(e.target.checked)} /> With
                phenomena
              </label>
              <button
                className="primary"
                disabled={planarDeck.length === 0}
                onClick={() => {
                  submitGameEvent({ type: 'start-planechase', deck: planarDeck });
                  onClose();
                }}
              >
                {planes === null ? 'Loading planes…' : `Start Planechase (${planarDeck.length} planes)`}
              </button>
            </div>
          )}
        </section>

        <section>
          <h3>Archenemy</h3>
          <p className="hint">One player against the rest, with a deck of every scheme there is, shuffled.</p>
          {game.archenemy ? (
            <div className="row">
              <span>On: {seatName(players, game.archenemy.seat)} is the archenemy.</span>
              <button className="danger" onClick={() => submitGameEvent({ type: 'archenemy-ended' })}>
                End Archenemy
              </button>
            </div>
          ) : (
            <div className="row">
              <label>
                Archenemy{' '}
                <select
                  value={archenemy ?? ''}
                  onChange={(e) => setArchenemy(Number(e.target.value) as SeatIndex)}
                  aria-label="Archenemy"
                >
                  {players.map((p) => (
                    <option key={p.player.seat} value={p.player.seat}>
                      {p.player.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="primary"
                disabled={schemeDeck.length === 0 || archenemy === null}
                onClick={() => {
                  if (archenemy === null) return;
                  submitGameEvent({ type: 'start-archenemy', seat: archenemy, deck: schemeDeck });
                  onClose();
                }}
              >
                {schemes === null ? 'Loading schemes…' : `Start Archenemy (${schemeDeck.length} schemes)`}
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

interface VariantsBarProps {
  readonly game: GameView;
  readonly players: Players;
}

/** The plane and the scheme in play, under the status bar, with what players do with them. */
export function VariantsBar({ game, players }: VariantsBarProps) {
  const { planechase, archenemy } = game.state;
  const [opened, setOpened] = useState<VariantCard | null>(null);
  return (
    <>
      {(planechase || archenemy) && (
        <div className="variants-bar" data-testid="variants-bar">
          {planechase && <PlanechaseControls planechase={planechase} onShow={setOpened} />}
          {archenemy && <ArchenemyControls archenemy={archenemy} players={players} onShow={setOpened} />}
        </div>
      )}
      {/* There from the start, so it knows a plane or scheme that comes up later is new. */}
      <VariantSpotlight game={game} opened={opened} onClose={() => setOpened(null)} />
    </>
  );
}

function PlanechaseControls({
  planechase,
  onShow,
}: {
  readonly planechase: Planechase;
  onShow(card: VariantCard): void;
}) {
  const plane = currentPlane(planechase);
  const next = currentPlane(planeswalk(planechase));
  const cost = planechase.rollsThisTurn === 0 ? 'free' : `costs {${planechase.rollsThisTurn}}`;
  return (
    <div className="variant">
      <span aria-hidden="true">🌀</span>
      {plane && (
        <button className="link" onClick={() => onShow(plane)} data-testid="plane">
          {plane.name}
        </button>
      )}
      <button onClick={() => submitGameEvent({ type: 'roll-planar-die' })}>Roll the planar die ({cost})</button>
      {next && <button onClick={() => submitGameEvent({ type: 'planeswalked', to: next })}>Planeswalk</button>}
    </div>
  );
}

function ArchenemyControls({
  archenemy,
  players,
  onShow,
}: {
  readonly archenemy: Archenemy;
  readonly players: Players;
  onShow(card: VariantCard): void;
}) {
  const self = players.find((p) => p.isSelf)?.player.seat;
  const yours = archenemy.seat === self;
  const scheme = currentScheme(archenemy);
  const next = archenemy.deck[setSchemeInMotion(archenemy).index];
  return (
    <div className="variant">
      <span aria-hidden="true">😈</span>
      <span>{yours ? 'You are' : `${seatName(players, archenemy.seat)} is`} the archenemy</span>
      {scheme && (
        <button className="link" onClick={() => onShow(scheme)} data-testid="scheme">
          {scheme.name}
        </button>
      )}
      {yours && next && (
        <button onClick={() => submitGameEvent({ type: 'scheme-set-in-motion', scheme: next })}>
          Set a scheme in motion
        </button>
      )}
      {archenemy.ongoing.map((ongoing) => (
        <span key={ongoing.id} className="chip">
          <button className="link" onClick={() => onShow(ongoing)}>
            {ongoing.name}
          </button>
          {yours && (
            <button
              aria-label={`Abandon ${ongoing.name}`}
              onClick={() => submitGameEvent({ type: 'scheme-abandoned', id: ongoing.id })}
            >
              ×
            </button>
          )}
        </span>
      ))}
    </div>
  );
}

/** A plane or scheme, big: for everyone for a few seconds when a new one comes up, or when someone clicks its name. */
function VariantSpotlight({
  game,
  opened,
  onClose,
}: {
  readonly game: GameView;
  readonly opened: VariantCard | null;
  onClose(): void;
}) {
  const fresh = useFreshLive(game, (entry) => announcesCard(entry.event), SHOW_FOR_MS);
  const [dismissed, setDismissed] = useState(-1);
  const latest = fresh.at(-1);
  const auto = latest && latest.seq > dismissed ? cardFor(latest.event, game.state) : null;
  const card = opened ?? auto;
  const details = useDetails(card?.id ?? null);
  if (!card) return null;
  const isPlane = details
    ? details.card.layout === 'planar'
    : game.state.planechase?.deck.some((c) => c.id === card.id);
  const close = () => {
    onClose();
    if (latest) setDismissed(latest.seq);
  };
  return (
    <div className="spotlight variant-spotlight" role="dialog" aria-label={card.name} data-testid="variant-spotlight">
      {details?.card.image ? (
        isPlane ? (
          <div className="plane-frame">
            <img src={cardImageUrl(details.card.image, 'large')} alt={card.name} />
          </div>
        ) : (
          <img className="spotlight-image" src={cardImageUrl(details.card.image, 'large')} alt={card.name} />
        )
      ) : (
        <h2>{card.name}</h2>
      )}
      {details && <CardText className="spotlight-text" text={details.card.oracleText} />}
      <button onClick={close}>Close</button>
    </div>
  );
}

/** Events that bring up a new plane or scheme. */
function announcesCard(event: GameView['live'][number]['event']): boolean {
  return (
    event.type === 'planechase-started' ||
    event.type === 'planeswalked' ||
    (event.type === 'planar-die-rolled' && event.result === 'planeswalk') ||
    event.type === 'scheme-set-in-motion'
  );
}

function cardFor(event: GameView['live'][number]['event'], state: GameState): VariantCard | null {
  if (event.type === 'scheme-set-in-motion') return event.scheme;
  if (event.type === 'planeswalked') return event.to;
  return state.planechase ? currentPlane(state.planechase) : null;
}
