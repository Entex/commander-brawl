import { toCustomCounter, type CustomCounter } from '@commander-brawl/domain';

const KEY = 'cb.counterPresets';

/** Counters you've made before, kept on this computer so they're one click away at the next table. */
export function loadPresets(): CustomCounter[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(raw) ? raw.map(toCustomCounter).filter((c): c is CustomCounter => c !== null) : [];
  } catch {
    return [];
  }
}

export function savePreset(counter: CustomCounter): void {
  const presets = loadPresets().filter((p) => p.id !== counter.id);
  localStorage.setItem(KEY, JSON.stringify([...presets, counter]));
}

export function forgetPreset(id: string): void {
  localStorage.setItem(KEY, JSON.stringify(loadPresets().filter((p) => p.id !== id)));
}

export function newCounterId(): string {
  return crypto.randomUUID().replaceAll('-', '');
}
