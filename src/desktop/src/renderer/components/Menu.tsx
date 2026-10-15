import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, type GameIconName } from '../icons/Icon';
import { isTyping } from '../keys';

/** Room kept between an open menu and the window's edges, in pixels. */
const EDGE = 8;

/** Where an open list sits: lined up with an edge of its button, and how tall it can be. */
interface Placement {
  readonly align: 'left' | 'right';
  readonly maxHeight: number | undefined;
}

/** A button that opens a short list of less-used actions. Closes on Escape or a click elsewhere. */
export function Menu({
  label,
  icon,
  shortcut,
  title,
  children,
}: {
  readonly label: string;
  readonly icon?: GameIconName;
  /** A key that opens (or closes) it, on its own: not while typing, nor with Ctrl or Alt. */
  readonly shortcut?: string;
  readonly title?: string;
  readonly children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!shortcut) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== shortcut || event.ctrlKey || event.metaKey || event.altKey || isTyping(event)) {
        return;
      }
      // Another panel covers the table.
      if (document.querySelector('.overlay')) return;
      event.preventDefault();
      setOpen((current) => !current);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shortcut]);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<Placement>({ align: 'right', maxHeight: undefined });

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Lined up with the button's right edge (a menu at the top right), unless that runs it past the window's left
  // edge (a menu on the left, like Roll): then with its left edge. Never taller than the window has room for.
  useLayoutEffect(() => {
    const button = root.current;
    const items = list.current;
    if (!open || !button || !items) return;
    const box = button.getBoundingClientRect();
    const width = items.offsetWidth;
    const align = box.right - width >= EDGE || box.left + width > window.innerWidth - EDGE ? 'right' : 'left';
    const top = items.getBoundingClientRect().top;
    const room = window.innerHeight - top - EDGE;
    const maxHeight = items.scrollHeight > room ? Math.max(120, room) : undefined;
    setPlacement((current) =>
      current.align === align && current.maxHeight === maxHeight ? current : { align, maxHeight },
    );
  }, [open]);

  return (
    <div className="menu" ref={root}>
      <button aria-haspopup="menu" aria-expanded={open} title={title} onClick={() => setOpen(!open)}>
        {icon && <Icon name={icon} />}
        {label}
      </button>
      {open && (
        <div
          ref={list}
          className={`menu-items menu-items-${placement.align}`}
          role="menu"
          style={placement.maxHeight === undefined ? undefined : { maxHeight: placement.maxHeight }}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
