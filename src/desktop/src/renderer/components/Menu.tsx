import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, type GameIconName } from '../icons/Icon';

/** A button that opens a short list of less-used actions. Closes on Escape or a click elsewhere. */
export function Menu({
  label,
  icon,
  children,
}: {
  readonly label: string;
  readonly icon?: GameIconName;
  readonly children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

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

  return (
    <div className="menu" ref={root}>
      <button aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        {icon && <Icon name={icon} />}
        {label}
      </button>
      {open && (
        <div className="menu-items" role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
