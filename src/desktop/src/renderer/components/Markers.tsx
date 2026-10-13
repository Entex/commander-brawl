import {
  DUNGEONS,
  DUNGEON_IDS,
  RING_ABILITIES,
  isLastRoom,
  type DayNight,
  type DungeonPosition,
  type GameState,
  type SeatIndex,
} from '@commander-brawl/domain';
import { submitGameEvent } from '../useGame';
import { Stepper } from './SeatDetails';

/** A player's markers, in their details: the monarch, the initiative, their dungeon, the Ring, the city's blessing. */
export function SeatMarkers({ seat, game }: { readonly seat: SeatIndex; readonly game: GameState }) {
  const state = game.seats[seat];
  if (!state) return null;
  return (
    <section data-testid="seat-markers">
      <h4>Markers</h4>
      <div className="marker-toggles">
        <button
          aria-pressed={game.monarch === seat}
          onClick={() => submitGameEvent({ type: 'monarch-set', seat: game.monarch === seat ? null : seat })}
        >
          👑 Monarch
        </button>
        <button
          aria-pressed={game.initiative === seat}
          title="Taking the initiative ventures into Undercity"
          onClick={() => submitGameEvent({ type: 'initiative-taken', seat: game.initiative === seat ? null : seat })}
        >
          Initiative
        </button>
        <button
          aria-pressed={state.citysBlessing}
          onClick={() => submitGameEvent({ type: 'citys-blessing-set', seat, has: !state.citysBlessing })}
        >
          City's blessing
        </button>
      </div>
      <Stepper
        label={`The Ring tempted${state.ringTempts > 0 ? ` (${Math.min(state.ringTempts, RING_ABILITIES)} of ${RING_ABILITIES} abilities)` : ''}`}
        unit="Ring temptation"
        value={state.ringTempts}
        onChange={(amount) => submitGameEvent({ type: 'ring-tempted', seat, amount })}
      />
      <DungeonProgress seat={seat} position={state.dungeon} completed={state.completedDungeons} />
    </section>
  );
}

/** Where the player is in a dungeon, and the rooms they can venture into next. */
function DungeonProgress({
  seat,
  position,
  completed,
}: {
  readonly seat: SeatIndex;
  readonly position: DungeonPosition | null;
  readonly completed: number;
}) {
  const inside = position !== null && !isLastRoom(position);
  const choices: DungeonPosition[] = inside
    ? (DUNGEONS[position.dungeon].rooms[position.room]?.next ?? []).map((room) => ({ dungeon: position.dungeon, room }))
    : DUNGEON_IDS.map((dungeon) => ({ dungeon, room: 0 }));
  const room = position && DUNGEONS[position.dungeon].rooms[position.room];
  return (
    <div className="dungeon" data-testid="dungeon">
      {position && room ? (
        <p>
          <b>{DUNGEONS[position.dungeon].name}:</b> {room.name}
          {isLastRoom(position) && ' (completed)'} <span className="hint">{room.effect}</span>
        </p>
      ) : (
        <p className="hint">Not in a dungeon.</p>
      )}
      {completed > 0 && <p className="hint">Dungeons completed: {completed}</p>}
      <div className="dungeon-choices">
        <span>{inside ? 'Venture into' : 'Venture into a dungeon'}</span>
        {choices.map((choice) => {
          const next = DUNGEONS[choice.dungeon].rooms[choice.room];
          return (
            <button
              key={`${choice.dungeon}-${choice.room}`}
              title={next?.effect}
              onClick={() => submitGameEvent({ type: 'ventured', seat, to: choice })}
            >
              {inside ? next?.name : DUNGEONS[choice.dungeon].name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const DAY_NIGHT_LABELS: Record<DayNight, string> = { day: '☀ Day', night: '☾ Night' };

/** Day or night, for the whole table. */
export function DayNightChoice({ value }: { readonly value: DayNight | null }) {
  return (
    <div className="marker-toggles" role="group" aria-label="Day or night">
      {([null, 'day', 'night'] as const).map((option) => (
        <button
          key={option ?? 'none'}
          aria-pressed={value === option}
          onClick={() => value !== option && submitGameEvent({ type: 'day-night-set', value: option })}
        >
          {option ? DAY_NIGHT_LABELS[option] : 'Neither'}
        </button>
      ))}
    </div>
  );
}

/** Day or night as it is now, click to switch. In the table bar, once a card has made it day or night. */
export function DayNightSwitch({ value }: { readonly value: DayNight }) {
  const other: DayNight = value === 'day' ? 'night' : 'day';
  return (
    <button
      className="day-night"
      data-testid="day-night"
      title={`Make it ${other}`}
      onClick={() => submitGameEvent({ type: 'day-night-set', value: other })}
    >
      {DAY_NIGHT_LABELS[value]}
    </button>
  );
}

export function StormStepper({ storm }: { readonly storm: number }) {
  return (
    <Stepper
      label="Storm count"
      unit="to the storm count"
      value={storm}
      onChange={(amount) => submitGameEvent({ type: 'storm-changed', amount })}
    />
  );
}
