import {
  COUNTER_COLORS,
  CUSTOM_COUNTER_RANGE,
  MAX_CUSTOM_COUNTERS,
  MAX_CUSTOM_COUNTER_NAME_LENGTH,
  toCustomCounter,
  type CounterColor,
  type CounterScope,
  type CustomCounter,
  type GameState,
} from '@commander-brawl/domain';
import { useState } from 'react';
import { forgetPreset, loadPresets, newCounterId, savePreset } from '../counterPresets';
import { Icon } from '../icons/Icon';
import { submitGameEvent } from '../useGame';
import { DayNightChoice, StormStepper } from './Markers';

interface CountersPanelProps {
  readonly game: GameState;
  onClose(): void;
}

/** Make up counters for anything the built-in ones don't cover. */
export function CountersPanel({ game, onClose }: CountersPanelProps) {
  const [editing, setEditing] = useState<CustomCounter | 'new' | null>(null);
  const [presets, setPresets] = useState(loadPresets);
  const atTable = new Set(game.customCounters.map((c) => c.id));
  const unused = presets.filter((p) => !atTable.has(p.id));
  const full = game.customCounters.length >= MAX_CUSTOM_COUNTERS;

  const save = (counter: CustomCounter) => {
    submitGameEvent({ type: 'custom-counter-saved', counter });
    savePreset(counter);
    setPresets(loadPresets());
    setEditing(null);
  };

  return (
    <div className="overlay" role="dialog" aria-label="Counters">
      <div className="panel counters-panel">
        <header className="panel-header">
          <h2>
            <Icon name="abacus" /> Counters
          </h2>
          <button onClick={onClose}>Done</button>
        </header>

        <section>
          <h3>For the whole table</h3>
          <DayNightChoice value={game.dayNight} />
          <StormStepper storm={game.storm} />
        </section>

        <section>
          <h3>At this table</h3>
          {game.customCounters.length === 0 && <p className="hint">None yet. Everyone sees the counters you add.</p>}
          {game.customCounters.map((counter) => (
            <div key={counter.id} className="counter-row" data-testid={`counter-${counter.name}`}>
              <span className={`swatch color-${counter.color}`} />
              <span className="counter-name">{counter.name}</span>
              <span className="hint">{describeCounter(counter)}</span>
              <button onClick={() => setEditing(counter)}>Edit</button>
              <button
                className="danger"
                onClick={() => submitGameEvent({ type: 'custom-counter-removed', id: counter.id })}
              >
                Remove
              </button>
            </div>
          ))}
        </section>

        {unused.length > 0 && (
          <section>
            <h3>Your saved counters</h3>
            {unused.map((preset) => (
              <div key={preset.id} className="counter-row">
                <span className={`swatch color-${preset.color}`} />
                <span className="counter-name">{preset.name}</span>
                <span className="hint">{describeCounter(preset)}</span>
                <button
                  disabled={full}
                  onClick={() => submitGameEvent({ type: 'custom-counter-saved', counter: preset })}
                >
                  Add
                </button>
                <button
                  className="link"
                  onClick={() => {
                    forgetPreset(preset.id);
                    setPresets(loadPresets());
                  }}
                >
                  Forget
                </button>
              </div>
            ))}
          </section>
        )}

        {editing ? (
          <CounterForm
            key={editing === 'new' ? 'new' : editing.id}
            initial={editing === 'new' ? null : editing}
            onSave={save}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <button className="primary" disabled={full} onClick={() => setEditing('new')}>
            New counter
          </button>
        )}
        {full && <p className="hint">A table can have {MAX_CUSTOM_COUNTERS} counters. Remove one to add another.</p>}
      </div>
    </div>
  );
}

export function describeCounter(counter: CustomCounter): string {
  const parts = [counter.scope === 'player' ? 'each player' : counter.scope === 'table' ? 'whole table' : 'on cards'];
  if (counter.start !== 0) parts.push(`starts at ${counter.start}`);
  if (counter.min !== null && counter.max !== null) parts.push(`${counter.min} to ${counter.max}`);
  else if (counter.min !== null) parts.push(`at least ${counter.min}`);
  else if (counter.max !== null) parts.push(`at most ${counter.max}`);
  if (counter.loseAt !== null) parts.push(`lose at ${counter.loseAt}`);
  return parts.join(' · ');
}

interface CounterFormProps {
  readonly initial: CustomCounter | null;
  onSave(counter: CustomCounter): void;
  onCancel(): void;
}

function CounterForm({ initial, onSave, onCancel }: CounterFormProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [color, setColor] = useState<CounterColor>(initial?.color ?? 'blue');
  const [scope, setScope] = useState<CounterScope>(initial?.scope ?? 'player');
  const [start, setStart] = useState(String(initial?.start ?? 0));
  const [min, setMin] = useState(initial ? numberText(initial.min) : '0');
  const [max, setMax] = useState(numberText(initial?.max ?? null));
  const [loseAt, setLoseAt] = useState(numberText(initial?.loseAt ?? null));

  const counter = toCustomCounter({
    id: initial?.id ?? 'draft',
    name,
    color,
    scope,
    start: parseLimit(start),
    min: parseLimit(min),
    max: parseLimit(max),
    loseAt: scope === 'player' ? parseLimit(loseAt) : null,
  });
  const limitsValid =
    parseLimit(start) !== null && [start, min, max, loseAt].every((text) => parseLimit(text) !== undefined);

  return (
    <form
      className="counter-form"
      aria-label="Counter"
      onSubmit={(event) => {
        event.preventDefault();
        if (counter && limitsValid) onSave({ ...counter, id: initial?.id ?? newCounterId() });
      }}
    >
      <h3>{initial ? `Edit ${initial.name}` : 'New counter'}</h3>
      <label className="field">
        <span>Name</span>
        <input
          value={name}
          maxLength={MAX_CUSTOM_COUNTER_NAME_LENGTH}
          placeholder="e.g. Bounty"
          autoFocus
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <div className="field">
        <span>Color</span>
        <div className="swatches" role="radiogroup" aria-label="Color">
          {COUNTER_COLORS.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={color === option}
              aria-label={option}
              className={`swatch color-${option}${color === option ? ' selected' : ''}`}
              onClick={() => setColor(option)}
            />
          ))}
        </div>
      </div>
      <div className="field">
        <span>Who has it</span>
        <div className="choices">
          <label>
            <input type="radio" checked={scope === 'player'} onChange={() => setScope('player')} /> Each player
          </label>
          <label>
            <input type="radio" checked={scope === 'table'} onChange={() => setScope('table')} /> The whole table
          </label>
          <label>
            <input type="radio" checked={scope === 'card'} onChange={() => setScope('card')} /> Cards (put it on a card
            in a player's details)
          </label>
        </div>
      </div>
      <div className="limits">
        <LimitInput label="Starts at" value={start} onChange={setStart} />
        <LimitInput label="Lowest" value={min} onChange={setMin} />
        <LimitInput label="Highest" value={max} onChange={setMax} />
        {scope === 'player' && <LimitInput label="Lose at" value={loseAt} onChange={setLoseAt} />}
      </div>
      {!limitsValid && (
        <p className="status status-reconnecting">Use whole numbers, and give the counter a starting value.</p>
      )}
      {limitsValid && name.trim() && !counter && (
        <p className="status status-reconnecting">The lowest value can't be above the highest.</p>
      )}
      <div className="row">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={!counter || !limitsValid}>
          Save
        </button>
      </div>
    </form>
  );
}

function LimitInput({
  label,
  value,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  onChange(value: string): void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input value={value} inputMode="numeric" placeholder="none" onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function numberText(value: number | null): string {
  return value === null ? '' : String(value);
}

/** Empty means "no limit" (null); anything that isn't a whole number in range is invalid (undefined). */
function parseLimit(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  return Number.isInteger(value) && Math.abs(value) <= CUSTOM_COUNTER_RANGE ? value : undefined;
}
