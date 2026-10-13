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
import { Icon } from '../icons/Icon';
import { submitGameEvent } from '../useGame';
import { Stepper } from './SeatDetails';

/** A player's markers, in their details: the monarch, the initiative, their dungeon, the Ring, the city's blessing. */
export function SeatMarkers({ seat, game }: { readonly seat: SeatIndex; readonly game: GameState }) {
  const state = game.seats[seat];
  if (!state) return null;
  return (
    <section data-testid="seat-markers">
      <h4>
        <Icon name="crown" /> Markers
      </h4>
      <div className="marker-toggles">
        <button
          aria-pressed={game.monarch === seat}
          onClick={() => submitGameEvent({ type: 'monarch-set', seat: game.monarch === seat ? null : seat })}
        >
          <Icon name="crown" /> Monarch
        </button>
        <button
          aria-pressed={game.initiative === seat}
          title="Taking the initiative ventures into Undercity"
          onClick={() => submitGameEvent({ type: 'initiative-taken', seat: game.initiative === seat ? null : seat })}
        >
          <Icon name="torch" /> Initiative
        </button>
        <button
          aria-pressed={state.citysBlessing}
          onClick={() => submitGameEvent({ type: 'citys-blessing-set', seat, has: !state.citysBlessing })}
        >
          <Icon name="angel-wings" /> City's blessing
        </button>
      </div>
      <Stepper
        icon="ring"
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

export function DayNightLabel({ value }: { readonly value: DayNight }) {
  return value === 'day' ? (
    <>
      <Icon name="sun" className="icon-day" /> Day
    </>
  ) : (
    <>
      <Icon name="moon" className="icon-night" /> Night
    </>
  );
}

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
          {option ? <DayNightLabel value={option} /> : 'Neither'}
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
      <DayNightLabel value={value} />
    </button>
  );
}

export function StormStepper({ storm }: { readonly storm: number }) {
  return (
    <Stepper
      icon="lightning-storm"
      label="Storm count"
      unit="to the storm count"
      value={storm}
      onChange={(amount) => submitGameEvent({ type: 'storm-changed', amount })}
    />
  );
}
