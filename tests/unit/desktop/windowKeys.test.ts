import { describe, expect, it } from 'vitest';
import { windowKey, type KeyInput } from '../../../src/desktop/src/main/windowKeys';

const press = (key: string, modifiers: Partial<KeyInput> = {}): KeyInput => ({
  type: 'keyDown',
  key,
  control: false,
  meta: false,
  shift: false,
  alt: false,
  ...modifiers,
});

describe('the keys a window keeps without its menu', () => {
  it.each([
    [press('F11'), 'full-screen'],
    [press('F12'), 'dev-tools'],
    [press('I', { control: true, shift: true }), 'dev-tools'],
    [press('=', { control: true }), 'zoom-in'],
    [press('+', { control: true, shift: true }), 'zoom-in'],
    [press('-', { control: true }), 'zoom-out'],
    [press('0', { control: true }), 'zoom-reset'],
    [press('0', { meta: true }), 'zoom-reset'],
  ] as const)('%o: %s', (input, action) => {
    expect(windowKey(input)).toBe(action);
  });

  it("leaves the app's own keys to it: + and − for life, Alt, Ctrl+K, and keys let go", () => {
    for (const input of [
      press('+'),
      press('-'),
      press('Alt', { alt: true }),
      press('k', { control: true }),
      press('=', { control: true, alt: true }),
      { ...press('F11'), type: 'keyUp' },
    ]) {
      expect(windowKey(input)).toBeNull();
    }
  });
});
