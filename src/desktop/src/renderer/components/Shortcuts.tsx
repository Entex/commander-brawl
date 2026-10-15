import { Icon } from '../icons/Icon';

/** Every keyboard shortcut at the table, by what it's for. */
const SHORTCUTS: readonly { readonly group: string; readonly keys: readonly (readonly [string, string])[] }[] = [
  {
    group: 'The turn',
    keys: [
      ['Space', 'Pass the turn (on your turn)'],
      ['Ctrl+Space', 'The next phase (on your turn)'],
      ['W', 'Wait! You have a response'],
      ['Enter', 'Resolve the newest wait, reminder or stop'],
      ['T', 'A trigger reminder for the phase the turn is in'],
    ],
  },
  {
    group: 'Life and dice',
    keys: [
      ['+ / −', 'Your life up or down by 1'],
      ['Page Up / Page Down', 'Your life up or down by 5'],
      ['R', 'The Roll menu'],
      ['D', 'Roll a d20'],
    ],
  },
  {
    group: 'Cards',
    keys: [
      ['Ctrl+K', 'Look up a card'],
      ['C', 'Show or hide Cards seen'],
      ['B', 'Show or hide the cards and counters on the videos'],
      ['Del', 'Take away the card, counter or note the pointer is on'],
      ['G', 'Put the card the pointer is on in the graveyard'],
      ['Ctrl+drag', 'A close-up of the card in the box drawn'],
      ['Alt+click', 'Add a token, counter or note at that spot; on one on the videos, what can be done with it'],
      ['Alt+drag', 'Move a card, counter or note on the videos (a counter onto a card: it goes on the card)'],
    ],
  },
  {
    group: 'The table',
    keys: [
      ['1–4', 'Enlarge that seat (again to go back)'],
      ['L', 'Show or hide the game log'],
      ['Ctrl+Z', 'Undo your last change'],
      ['Esc', 'Close a panel or menu; back to the usual seats'],
      ['? or F1', 'These shortcuts'],
    ],
  },
];

/** The keyboard shortcuts, listed. Ctrl is ⌘ on a Mac. */
export function ShortcutsPanel({ onClose }: { onClose(): void }) {
  return (
    <div className="overlay" role="dialog" aria-label="Keyboard shortcuts" onClick={onClose}>
      <div className="panel shortcuts-panel" onClick={(event) => event.stopPropagation()}>
        <header className="panel-header">
          <h2>
            <Icon name="keyboard" /> Keyboard shortcuts
          </h2>
          <button onClick={onClose}>Close</button>
        </header>
        <p className="hint">Not while typing in a box. On a Mac, Ctrl is ⌘.</p>
        <div className="shortcut-groups">
          {SHORTCUTS.map(({ group, keys }) => (
            <section key={group}>
              <h3>{group}</h3>
              <dl>
                {keys.map(([key, what]) => (
                  <div key={key} className="shortcut">
                    <dt>
                      <kbd>{key}</kbd>
                    </dt>
                    <dd>{what}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
