import type { SeatIndex } from '@commander-brawl/domain';
import { useEffect, useRef, useState } from 'react';

interface LifeCounterProps {
  readonly seat: SeatIndex;
  readonly life: number;
  onChange(amount: number): void;
}

// Clicks this close together become one change, so three taps on −1 are logged as "−3", not three entries.
const GROUP_MS = 700;

export function LifeCounter({ seat, life, onChange }: LifeCounterProps) {
  const [draft, setDraft] = useState(0);
  const draftRef = useRef(0);
  const timer = useRef<number | null>(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const flush = () => {
    timer.current = null;
    const amount = draftRef.current;
    draftRef.current = 0;
    setDraft(0);
    if (amount !== 0) onChangeRef.current(amount);
  };

  // Don't lose a change that's still being grouped when the seat goes away.
  useEffect(
    () => () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        if (draftRef.current !== 0) onChangeRef.current(draftRef.current);
      }
    },
    [],
  );

  const add = (amount: number) => {
    draftRef.current += amount;
    setDraft(draftRef.current);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, GROUP_MS);
  };

  return (
    <div className="life" data-testid={`life-${seat}`}>
      <button aria-label="Lose 5 life" onClick={() => add(-5)}>
        −5
      </button>
      <button aria-label="Lose 1 life" onClick={() => add(-1)}>
        −1
      </button>
      <span className="life-total" data-testid={`life-total-${seat}`}>
        {life + draft}
      </span>
      <button aria-label="Gain 1 life" onClick={() => add(1)}>
        +1
      </button>
      <button aria-label="Gain 5 life" onClick={() => add(5)}>
        +5
      </button>
      {draft !== 0 && <span className="life-draft">{draft > 0 ? `+${draft}` : `−${-draft}`}</span>}
    </div>
  );
}
