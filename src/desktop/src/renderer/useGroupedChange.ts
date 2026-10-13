import { useEffect, useRef, useState } from 'react';

// Clicks this close together become one change, so three taps on −1 are logged as "−3", not three entries.
const GROUP_MS = 700;

export interface GroupedChange {
  /** What's been clicked but not sent yet. Show it on top of the real value. */
  readonly draft: number;
  add(amount: number): void;
  /** Send whatever is waiting right now. */
  flush(): void;
}

export function useGroupedChange(onChange: (amount: number) => void): GroupedChange {
  const [draft, setDraft] = useState(0);
  const draftRef = useRef(0);
  const timer = useRef<number | null>(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Don't lose a change that's still being grouped when the control goes away.
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      if (draftRef.current !== 0) onChangeRef.current(draftRef.current);
    },
    [],
  );

  const flush = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    const amount = draftRef.current;
    draftRef.current = 0;
    setDraft(0);
    if (amount !== 0) onChangeRef.current(amount);
  };

  const add = (amount: number) => {
    draftRef.current += amount;
    setDraft(draftRef.current);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, GROUP_MS);
  };

  return { draft, add, flush };
}

export function formatChange(amount: number): string {
  return amount > 0 ? `+${amount}` : `−${-amount}`;
}
