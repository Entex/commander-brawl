/** A key pressed in the window, as Electron tells it before the page gets it. */
export interface KeyInput {
  readonly type: string;
  readonly key: string;
  readonly control: boolean;
  readonly meta: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
}

export type WindowKey = 'full-screen' | 'dev-tools' | 'zoom-in' | 'zoom-out' | 'zoom-reset';

/**
 * The keys of a window's usual menu worth keeping without the menu (see withoutMenuBar in main): full screen, the
 * developer tools, and zoom. Null for any other key, which goes to the page.
 */
export function windowKey(input: KeyInput): WindowKey | null {
  if (input.type !== 'keyDown') return null;
  const ctrl = (input.control || input.meta) && !input.alt;
  const key = input.key.toLowerCase();
  if (key === 'f11' && !ctrl) return 'full-screen';
  if (key === 'f12' || (ctrl && input.shift && key === 'i')) return 'dev-tools';
  if (ctrl && (key === '+' || key === '=')) return 'zoom-in';
  if (ctrl && key === '-') return 'zoom-out';
  if (ctrl && key === '0') return 'zoom-reset';
  return null;
}
