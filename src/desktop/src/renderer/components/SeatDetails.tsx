import {
  MAX_COMMANDERS,
  MAX_COMMANDER_NAME_LENGTH,
  isOut,
  lossReason,
  type CommanderIndex,
  type GameState,
  type SeatIndex,
} from '@commander-brawl/domain';
import { useState } from 'react';
import { describeLoss, commanderName, seatName, type Players } from '../names';
import { submitGameEvent } from '../useGame';
import { formatChange, useGroupedChange } from '../useGroupedChange';

interface SeatDetailsProps {
  readonly seat: SeatIndex;
  readonly game: GameState;
  readonly players: Players;
  onClose(): void;
}

/** Everything about one player's game that doesn't fit on the video: commanders, commander damage, out status. */
export function SeatDetails({ seat, game, players, onClose }: SeatDetailsProps) {
  const opponents = players.filter((p) => p.player.seat !== seat);
  return (
    <div className="seat-details" data-testid={`seat-details-${seat}`} role="dialog" aria-label={`${seatName(players, seat)}'s details`}>
      <header className="panel-header">
        <h3>{seatName(players, seat)}</h3>
        <button onClick={onClose}>Close</button>
      </header>

      <section>
        <h4>Commanders</h4>
        {/* Keyed by the names, so the form starts over when someone else renames them. */}
        <CommanderNames
          key={(game.seats[seat]?.commanders ?? []).join('\n')}
          seat={seat}
          names={game.seats[seat]?.commanders ?? ['']}
        />
      </section>

      <section>
        <h4>Commander damage taken</h4>
        {opponents.length === 0 && <p className="hint">Nobody else is at the table yet.</p>}
        {opponents.flatMap((opponent) =>
          (game.seats[opponent.player.seat]?.commanders ?? ['']).map((_, index) => {
            const commander = index as CommanderIndex;
            const from = opponent.player.seat;
            return (
              <DamageRow
                key={`${from}-${commander}`}
                label={commanderName(game, players, from, commander)}
                damage={game.seats[seat]?.commanderDamage[from]?.[commander] ?? 0}
                onChange={(amount) => submitGameEvent({ type: 'commander-damage', from, commander, to: seat, amount })}
              />
            );
          }),
        )}
      </section>

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

function DamageRow({ label, damage, onChange }: { readonly label: string; readonly damage: number; onChange(amount: number): void }) {
  const { draft, add } = useGroupedChange(onChange);
  const shown = damage + draft;
  return (
    <div className="damage-row" data-testid={`damage-${label}`}>
      <span className="damage-label">{label}</span>
      <button aria-label={`Remove 1 damage from ${label}`} disabled={shown <= 0} onClick={() => add(-1)}>
        −1
      </button>
      <span className="damage-value">{shown}</span>
      <button aria-label={`Add 1 damage from ${label}`} onClick={() => add(1)}>
        +1
      </button>
      <button aria-label={`Add 5 damage from ${label}`} onClick={() => add(5)}>
        +5
      </button>
      {draft !== 0 && <span className="hint">{formatChange(draft)}</span>}
    </div>
  );
}

function OutStatus({ seat, game, players }: { readonly seat: SeatIndex; readonly game: GameState; readonly players: Players }) {
  const state = game.seats[seat];
  if (!state) return null;
  const reason = lossReason(state);
  const out = isOut(state);
  const set = (value: boolean | null) => submitGameEvent({ type: 'out-set', seat, out: value });

  if (state.outOverride === false && reason) {
    return (
      <div className="status-row">
        <span>Still in, despite: {describeLoss(reason, game, players).toLowerCase()}.</span>
        <button onClick={() => set(null)}>Follow the rules again</button>
      </div>
    );
  }
  if (out) {
    return (
      <div className="status-row">
        <span>Out{reason && state.outOverride === null ? `: ${describeLoss(reason, game, players).toLowerCase()}` : ''}.</span>
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
