import { MAX_CHANGE, type SeatIndex } from '@commander-brawl/domain';
import { useRef, useState } from 'react';
import { formatChange, useGroupedChange } from '../useGroupedChange';

interface LifeCounterProps {
  readonly seat: SeatIndex;
  readonly life: number;
  /** Without it, the total is only shown (watching, or the clean view for streaming). */
  onChange?: (amount: number) => void;
}

export function LifeCounter({ seat, life, onChange }: LifeCounterProps) {
  const { draft, add, flush } = useGroupedChange(onChange ?? noChange);
  const [typing, setTyping] = useState(false);
  const shown = life + draft;

  if (!onChange) {
    return (
      <div className="life life-shown" data-testid={`life-${seat}`}>
        <span className="life-total" data-testid={`life-total-${seat}`}>
          {life}
        </span>
      </div>
    );
  }
  return (
    <div className="life" data-testid={`life-${seat}`}>
      <button aria-label="Lose 5 life" onClick={() => add(-5)}>
        −5
      </button>
      <button aria-label="Lose 1 life" onClick={() => add(-1)}>
        −1
      </button>
      {typing ? (
        <LifeInput
          current={shown}
          onDone={(value) => {
            setTyping(false);
            if (value === null) return;
            const amount = value - shown;
            if (amount !== 0 && Math.abs(amount) <= MAX_CHANGE) {
              add(amount);
              flush();
            }
          }}
        />
      ) : (
        <button
          className="life-total"
          title="Click to type a number"
          data-testid={`life-total-${seat}`}
          onClick={() => setTyping(true)}
        >
          {shown}
        </button>
      )}
      <button aria-label="Gain 1 life" onClick={() => add(1)}>
        +1
      </button>
      <button aria-label="Gain 5 life" onClick={() => add(5)}>
        +5
      </button>
      {draft !== 0 && <span className="life-draft">{formatChange(draft)}</span>}
    </div>
  );
}

function noChange(): void {}

/** Type a new total. Enter or clicking away sets it, Escape cancels. */
function LifeInput({ current, onDone }: { readonly current: number; onDone(value: number | null): void }) {
  const done = useRef(false);
  const finish = (text: string | null) => {
    if (done.current) return;
    done.current = true;
    const value = text === null ? NaN : Number(text.trim());
    onDone(text !== null && text.trim() !== '' && Number.isInteger(value) ? value : null);
  };
  return (
    <input
      className="life-input"
      aria-label="Life total"
      inputMode="numeric"
      autoFocus
      defaultValue={current}
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') finish(event.currentTarget.value);
        if (event.key === 'Escape') finish(null);
      }}
      onBlur={(event) => finish(event.currentTarget.value)}
    />
  );
}
