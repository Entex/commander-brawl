import { counterValue, type GameState } from '@commander-brawl/domain';
import { submitGameEvent } from '../useGame';
import { Stepper } from './SeatDetails';

/** Counters that belong to the whole table, in a bar under the toolbar. */
export function TableCounters({ game }: { readonly game: GameState }) {
  const counters = game.customCounters.filter((c) => c.scope === 'table');
  if (counters.length === 0) return null;
  return (
    <div className="table-counters" data-testid="table-counters">
      {counters.map((counter) => (
        <Stepper
          key={counter.id}
          label={counter.name}
          unit={counter.name}
          color={counter.color}
          value={counterValue(counter, game.tableCounters)}
          min={counter.min}
          max={counter.max}
          onChange={(amount) => submitGameEvent({ type: 'custom-counter-changed', id: counter.id, seat: null, amount })}
        />
      ))}
    </div>
  );
}
