import { GAME_ICONS, type GameIconName } from './gameIcons';

export type { GameIconName } from './gameIcons';

/** A game-icons.net icon, in the current text color, sized to the text (1.2em) unless the CSS says otherwise. */
export function Icon({ name, className }: { readonly name: GameIconName; readonly className?: string }) {
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      viewBox="0 0 512 512"
      aria-hidden="true"
      focusable="false"
      // Our own icon data (see gameIcons.ts), never anything from outside.
      dangerouslySetInnerHTML={{ __html: GAME_ICONS[name] }}
    />
  );
}
