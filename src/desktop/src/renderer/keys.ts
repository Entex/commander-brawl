/** Whether a key press is someone typing (in a text box, a list to pick from…), not a shortcut. */
export function isTyping(event: KeyboardEvent): boolean {
  const target = event.target;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

/** Whether a panel covers the table (Decks, Camera, Rule 0…), or the menu is open: the table's keys are off. */
export function panelOpen(): boolean {
  return document.querySelector('.overlay, [role="menu"]') !== null;
}
