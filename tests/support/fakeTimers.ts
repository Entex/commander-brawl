import type { Timers } from '@commander-brawl/application';

/** Timers driven by hand, so tests can jump forward in time. */
export class FakeTimers implements Timers {
  private time = 0;
  private nextId = 0;
  private readonly pending = new Map<number, { at: number; callback: () => void }>();

  now(): number {
    return this.time;
  }

  setTimeout(callback: () => void, ms: number): () => void {
    const id = this.nextId++;
    this.pending.set(id, { at: this.time + ms, callback });
    return () => this.pending.delete(id);
  }

  advance(ms: number): void {
    const until = this.time + ms;
    for (;;) {
      const due = [...this.pending.entries()]
        .filter(([, timer]) => timer.at <= until)
        .sort(([, a], [, b]) => a.at - b.at)[0];
      if (!due) break;
      const [id, timer] = due;
      this.pending.delete(id);
      this.time = timer.at;
      timer.callback();
    }
    this.time = until;
  }
}
