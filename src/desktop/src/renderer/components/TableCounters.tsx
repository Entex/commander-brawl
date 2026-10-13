import { counterValue, type GameState } from '@commander-brawl/domain';
import { submitGameEvent } from '../useGame';
import { DayNightSwitch, StormStepper } from './Markers';
import { Stepper } from './SeatDetails';

/** Counters and markers that belong to the whole table, in a bar under the toolbar. */
export function TableCounters({ game }: { readonly game: GameState }) {
  const counters = game.customCounters.filter((c) => c.scope === 'table');
  // Day or night, and the storm count, show once they're in play.
  if (counters.length === 0 && game.dayNight === null && game.storm === 0) return null;
  return (
    <div className="table-counters" data-testid="table-counters">
      {game.dayNight && <DayNightSwitch value={game.dayNight} />}
      {game.storm > 0 && <StormStepper storm={game.storm} />}
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
