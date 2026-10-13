import { Pointers, type Pointer, type TableSession } from '@commander-brawl/application';
import type { SeatIndex } from '@commander-brawl/domain';
import { useCallback, useEffect, useRef, useState } from 'react';
import { IpcTableSignaling } from './api';

/** How long a ping or an arrow stays on screen. */
export const POINTER_SHOW_MS = 6_000;
const MAX_MARKS = 20;

/** A ping or an arrow on screen: who made it, and what it points at. */
export interface Mark {
  readonly id: number;
  /** The seat of the player pointing, for their color. */
  readonly seat: SeatIndex;
  readonly name: string;
  readonly pointer: Pointer;
}

/** Pings and arrows: yours, sent to everyone, and everyone else's. Each disappears after a few seconds. */
export function usePointers(session: TableSession<MediaStreamTrack>): {
  readonly marks: readonly Mark[];
  point(pointer: Pointer): void;
} {
  const [marks, setMarks] = useState<Mark[]>([]);
  const pointersRef = useRef<Pointers | null>(null);
  const nextId = useRef(0);
  const timers = useRef(new Set<number>());

  const add = useCallback((mark: Omit<Mark, 'id'>) => {
    const id = ++nextId.current;
    setMarks((current) => [...current.slice(1 - MAX_MARKS), { ...mark, id }]);
    const timer = window.setTimeout(() => {
      timers.current.delete(timer);
      setMarks((current) => current.filter((m) => m.id !== id));
    }, POINTER_SHOW_MS);
    timers.current.add(timer);
  }, []);

  useEffect(() => {
    const others = () =>
      session
        .getState()
        .seats.filter((seat) => !seat.isSelf)
        .map((seat) => seat.player.id);
    const pointers = new Pointers(new IpcTableSignaling(), others);
    pointers.start();
    pointers.subscribe((memberId, pointer) => {
      const sender = session.getState().seats.find((seat) => seat.player.id === memberId);
      if (sender) add({ seat: sender.player.seat, name: sender.player.name, pointer });
    });
    pointersRef.current = pointers;
    const pending = timers.current;
    return () => {
      pointers.dispose();
      pointersRef.current = null;
      for (const timer of pending) window.clearTimeout(timer);
      pending.clear();
    };
  }, [session, add]);

  const point = useCallback(
    (pointer: Pointer) => {
      const self = session.getState().seats.find((seat) => seat.isSelf);
      if (!self) return;
      pointersRef.current?.point(pointer);
      add({ seat: self.player.seat, name: 'You', pointer });
    },
    [session, add],
  );

  return { marks, point };
}
