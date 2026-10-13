import {
  MAX_COMMANDERS,
  MAX_COMMANDER_NAME_LENGTH,
  MAX_SPEED,
  PLAYER_COUNTERS,
  commanderTax,
  counterValue,
  deckSize,
  isOut,
  lossReason,
  type CommanderIndex,
  type CounterColor,
  type GameState,
  type SeatIndex,
} from '@commander-brawl/domain';
import { useState } from 'react';
import { COUNTER_NAMES, commanderName, describeLoss, seatName, type Players } from '../names';
import { submitGameEvent } from '../useGame';
import { formatChange, useGroupedChange } from '../useGroupedChange';
import { SeatMarkers } from './Markers';
import { PermanentsSection } from './Permanents';

interface SeatDetailsProps {
  readonly seat: SeatIndex;
  readonly game: GameState;
  readonly players: Players;
  /** Shows a card in the Cards panel. */
  onOpenCard(cardId: string): void;
  onClose(): void;
}

/** Everything about one player's game that doesn't fit on the video. */
export function SeatDetails({ seat, game, players, onOpenCard, onClose }: SeatDetailsProps) {
  const state = game.seats[seat];
  if (!state) return null;
  const opponents = players.filter((p) => p.player.seat !== seat);
  return (
    <div
      className="seat-details"
      data-testid={`seat-details-${seat}`}
      role="dialog"
      aria-label={`${seatName(players, seat)}'s details`}
    >
      <header className="panel-header">
        <h3>{seatName(players, seat)}</h3>
        <button onClick={onClose}>Close</button>
      </header>

      {state.deck && (
        <section>
          <h4>Deck</h4>
          <p className="deck-line">
            {state.deck.name} · {deckSize(state.deck)} cards
          </p>
        </section>
      )}

      <section>
        <h4>Commanders</h4>
        {/* Keyed by the names, so the form starts over when someone else renames them. */}
        <CommanderNames key={state.commanders.join('\n')} seat={seat} names={state.commanders} />
        {state.commanders.map((_, index) => {
          const commander = index as CommanderIndex;
          const name = commanderName(game, players, seat, commander);
          const casts = state.commanderCasts[commander] ?? 0;
          return (
            <div key={commander} className="stepper-row">
              <span className="stepper-label">
                {name}: cast {casts}× · tax +{commanderTax(state, commander)}
              </span>
              <button
                aria-label={`Take back a cast of ${name}`}
                disabled={casts === 0}
                onClick={() => submitGameEvent({ type: 'commander-cast', seat, commander, amount: -1 })}
              >
                −1
              </button>
              <button onClick={() => submitGameEvent({ type: 'commander-cast', seat, commander, amount: 1 })}>
                Cast {name}
              </button>
            </div>
          );
        })}
      </section>

      <section>
        <h4>Counters</h4>
        {PLAYER_COUNTERS.map((counter) => (
          <Stepper
            key={counter}
            label={COUNTER_NAMES[counter]}
            unit={COUNTER_NAMES[counter].toLowerCase()}
            value={state.counters[counter]}
            max={counter === 'speed' ? MAX_SPEED : null}
            onChange={(amount) => submitGameEvent({ type: 'counter-changed', seat, counter, amount })}
          />
        ))}
        {game.customCounters
          .filter((counter) => counter.scope === 'player')
          .map((counter) => (
            <Stepper
              key={counter.id}
              label={counter.name}
              unit={counter.name}
              color={counter.color}
              value={counterValue(counter, state.custom)}
              min={counter.min}
              max={counter.max}
              onChange={(amount) => submitGameEvent({ type: 'custom-counter-changed', id: counter.id, seat, amount })}
            />
          ))}
      </section>

      <section>
        <h4>Commander damage taken</h4>
        {opponents.length === 0 && <p className="hint">Nobody else is at the table yet.</p>}
        {opponents.flatMap((opponent) =>
          (game.seats[opponent.player.seat]?.commanders ?? ['']).map((_, index) => {
            const commander = index as CommanderIndex;
            const from = opponent.player.seat;
            const label = commanderName(game, players, from, commander);
            return (
              <Stepper
                key={`${from}-${commander}`}
                label={label}
                unit={`damage from ${label}`}
                value={state.commanderDamage[from]?.[commander] ?? 0}
                big
                onChange={(amount) => submitGameEvent({ type: 'commander-damage', from, commander, to: seat, amount })}
              />
            );
          }),
        )}
      </section>

      <PermanentsSection seat={seat} game={game} onOpenCard={onOpenCard} />

      <SeatMarkers seat={seat} game={game} />

      <section>
        <h4>Status</h4>
        <OutStatus seat={seat} game={game} players={players} />
      </section>
    </div>
  );
}

function CommanderNames({ seat, names }: { readonly seat: SeatIndex; readonly names: readonly string[] }) {
  const [draft, setDraft] = useState<readonly string[]>(names);
  const changed = draft.length !== names.length || draft.some((n, i) => n.trim() !== names[i]);
  const save = () => submitGameEvent({ type: 'commanders-named', seat, names: draft.map((n) => n.trim()) });

  return (
    <form
      className="commander-names"
      onSubmit={(event) => {
        event.preventDefault();
        if (changed) save();
      }}
    >
      {draft.map((name, index) => (
        <input
          key={index}
          value={name}
          maxLength={MAX_COMMANDER_NAME_LENGTH}
          placeholder={index === 0 ? 'Commander' : 'Partner or background'}
          aria-label={index === 0 ? 'Commander' : 'Partner or background'}
          onChange={(event) => setDraft(draft.map((n, i) => (i === index ? event.target.value : n)))}
        />
      ))}
      <div className="row">
        {draft.length < MAX_COMMANDERS ? (
          <button type="button" className="link" onClick={() => setDraft([...draft, ''])}>
            + Partner or background
          </button>
        ) : (
          <button type="button" className="link" onClick={() => setDraft(draft.slice(0, 1))}>
            Only one commander
          </button>
        )}
        <button type="submit" disabled={!changed}>
          Save
        </button>
      </div>
    </form>
  );
}

interface StepperProps {
  readonly label: string;
  /** Finishes the button labels: "Add 1 poison", "Remove 1 damage from Atraxa". */
  readonly unit: string;
  readonly value: number;
  /** Null means no limit. */
  readonly min?: number | null;
  readonly max?: number | null;
  readonly color?: CounterColor;
  /** Offer +5 as well, for things that come in big chunks. */
  readonly big?: boolean;
  onChange(amount: number): void;
}

export function Stepper({ label, unit, value, min = 0, max = null, color, big = false, onChange }: StepperProps) {
  const { draft, add } = useGroupedChange(onChange);
  const shown = value + draft;
  return (
    <div className="stepper-row">
      <span className="stepper-label">
        {color && <span className={`swatch color-${color}`} />}
        {label}
      </span>
      <button aria-label={`Remove 1 ${unit}`} disabled={min !== null && shown <= min} onClick={() => add(-1)}>
        −1
      </button>
      <span className="stepper-value">{shown}</span>
      <button aria-label={`Add 1 ${unit}`} disabled={max !== null && shown >= max} onClick={() => add(1)}>
        +1
      </button>
      {big && (
        <button aria-label={`Add 5 ${unit}`} onClick={() => add(5)}>
          +5
        </button>
      )}
      {draft !== 0 && <span className="hint">{formatChange(draft)}</span>}
    </div>
  );
}

function OutStatus({
  seat,
  game,
  players,
}: {
  readonly seat: SeatIndex;
  readonly game: GameState;
  readonly players: Players;
}) {
  const state = game.seats[seat];
  if (!state) return null;
  const reason = lossReason(game, seat);
  const set = (value: boolean | null) => submitGameEvent({ type: 'out-set', seat, out: value });

  if (state.outOverride === false && reason) {
    return (
      <div className="status-row">
        <span>Still in, despite: {describeLoss(reason, game, players).toLowerCase()}.</span>
        <button onClick={() => set(null)}>Follow the rules again</button>
      </div>
    );
  }
  if (isOut(game, seat)) {
    return (
      <div className="status-row">
        <span>
          Out{reason && state.outOverride === null ? `: ${describeLoss(reason, game, players).toLowerCase()}` : ''}.
        </span>
        <button onClick={() => set(state.outOverride === true && !reason ? null : false)}>Still in</button>
      </div>
    );
  }
  return (
    <div className="status-row">
      <span>Playing.</span>
      <button className="danger" onClick={() => set(true)}>
        Mark as out
      </button>
    </div>
  );
}
