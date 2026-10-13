import type { GameView } from '@commander-brawl/application';
import { MAX_DIE_SIDES, MAX_ROLLS, isOut, type GameState, type SeatIndex } from '@commander-brawl/domain';
import { useState } from 'react';
import { describeRoll } from '../describeEvent';
import { Icon, type GameIconName } from '../icons/Icon';
import type { Players } from '../names';
import { submitGameEvent } from '../useGame';
import { Menu } from './Menu';
import { useFreshLive } from './ResponseCalls';

const SHOW_FOR_MS = 8_000;
const QUICK_DICE = [6, 20, 4, 8, 10, 12];

/**
 * Dice, coins and random picks. The host rolls, so everyone can trust the result: it's in the game log, and
 * nobody can roll again until they like it.
 */
export function RollMenu({ game, players }: { readonly game: GameState | null; readonly players: Players }) {
  const self = players.find((p) => p.isSelf)?.player.seat ?? null;
  // Players still in the game; a random opponent is one of them other than you.
  const inGame = players.map((p) => p.player.seat).filter((seat) => !game || !isOut(game, seat));
  const opponents = inGame.filter((seat) => seat !== self);
  return (
    <Menu label="Roll" icon="rolling-dices">
      {(close) => (
        <>
          {QUICK_DICE.map((sides) => (
            <button
              key={sides}
              role="menuitem"
              onClick={() => {
                close();
                submitGameEvent({ type: 'roll-dice', sides, count: 1 });
              }}
            >
              <Icon name="dice-twenty-faces-twenty" />d{sides}
            </button>
          ))}
          <button
            role="menuitem"
            onClick={() => {
              close();
              submitGameEvent({ type: 'flip-coins', count: 1 });
            }}
          >
            <Icon name="coinflip" />
            Flip a coin
          </button>
          <PickButton label="Random opponent" icon="convergence-target" seats={opponents} close={close} />
          <PickButton label="Random player" icon="meeple-group" seats={inGame} close={close} />
          <CustomRoll close={close} />
        </>
      )}
    </Menu>
  );
}

function PickButton({
  label,
  icon,
  seats,
  close,
}: {
  readonly label: string;
  readonly icon: GameIconName;
  readonly seats: readonly SeatIndex[];
  close(): void;
}) {
  return (
    <button
      role="menuitem"
      disabled={seats.length === 0}
      onClick={() => {
        close();
        submitGameEvent({ type: 'pick-seat', seats: [...seats] });
      }}
    >
      <Icon name={icon} />
      {label}
    </button>
  );
}

/** Any number of dice with any number of sides: "3 d 6". */
function CustomRoll({ close }: { close(): void }) {
  const [count, setCount] = useState(2);
  const [sides, setSides] = useState(6);
  const valid =
    Number.isInteger(count) &&
    count >= 1 &&
    count <= MAX_ROLLS &&
    Number.isInteger(sides) &&
    sides >= 2 &&
    sides <= MAX_DIE_SIDES;
  return (
    <form
      className="custom-roll"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) return;
        close();
        submitGameEvent({ type: 'roll-dice', sides, count });
      }}
    >
      <input
        type="number"
        min={1}
        max={MAX_ROLLS}
        value={Number.isNaN(count) ? '' : count}
        aria-label="How many dice"
        onChange={(event) => setCount(event.target.valueAsNumber)}
      />
      d
      <input
        type="number"
        min={2}
        max={MAX_DIE_SIDES}
        value={Number.isNaN(sides) ? '' : sides}
        aria-label="Sides"
        onChange={(event) => setSides(event.target.valueAsNumber)}
      />
      <button type="submit" disabled={!valid}>
        Roll
      </button>
    </form>
  );
}

/** The latest rolls, flips and picks, big on every screen for a few seconds. */
export function RollBanner({ game, players }: { readonly game: GameView | null; readonly players: Players }) {
  const rolls = useFreshLive(game, (entry) => isRoll(entry.event.type), SHOW_FOR_MS);
  if (rolls.length === 0) return null;
  return (
    <div className="roll-banner" role="status" data-testid="roll-banner">
      {rolls.slice(-3).map((entry) => (
        <p key={entry.seq}>
          <Icon name={ICONS[entry.event.type] ?? 'rolling-dices'} /> {describeRoll(entry, players)}
        </p>
      ))}
    </div>
  );
}

const ICONS: Record<string, GameIconName> = {
  'dice-rolled': 'rolling-dices',
  'coins-flipped': 'coinflip',
  'seat-picked': 'convergence-target',
  'planar-die-rolled': 'magic-portal',
};

function isRoll(type: string): boolean {
  return type in ICONS;
}
