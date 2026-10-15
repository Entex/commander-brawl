import { commanderTax, type Card, type CommanderIndex, type GameState, type SeatIndex } from '@commander-brawl/domain';
import { cardImageUrl } from '@commander-brawl/infrastructure/browser';
import { useCardsByName } from '../useCards';
import { Symbols } from './CardText';

interface CommanderBadgesProps {
  readonly seat: SeatIndex;
  readonly game: GameState;
  onOpenCard(cardId: string): void;
}

const COLOR_ORDER = ['W', 'U', 'B', 'R', 'G'];

/**
 * Each of the player's commanders, small, beside their name: the artwork and commander tax, with the name and color
 * identity while the pointer is on it. Click for the card.
 */
export function CommanderBadges({ seat, game, onOpenCard }: CommanderBadgesProps) {
  const state = game.seats[seat];
  const names = state?.commanders.filter((name) => name !== '') ?? [];
  const cards = useCardsByName(names);
  if (!state || names.length === 0) return null;

  return (
    <div className="seat-commanders" data-testid={`commanders-${seat}`}>
      {state.commanders.map((name, index) => {
        if (!name) return null;
        const card = cards[names.indexOf(name)] ?? null;
        const tax = commanderTax(state, index as CommanderIndex);
        const colors = card
          ? [...card.colorIdentity].sort((a, b) => COLOR_ORDER.indexOf(a) - COLOR_ORDER.indexOf(b))
          : [];
        const shownName = card?.name.split(' // ')[0] ?? name;
        const art = card?.image ?? null;
        return (
          <button
            key={index}
            className={`commander-badge${art ? ' commander-badge-art' : ''}`}
            disabled={!card}
            aria-label={shownName}
            title={card ? `Show ${card.name}\n${artCredit(card)}` : name}
            onClick={() => card && onOpenCard(card.id)}
          >
            {art && <img className="commander-art" src={cardImageUrl(art, 'art_crop')} alt="" />}
            <span className="commander-name">{shownName}</span>
            {colors.length > 0 && (
              <span className="commander-colors">
                <Symbols text={colors.map((c) => `{${c}}`).join('')} />
              </span>
            )}
            {tax > 0 && (
              <span className="commander-tax" title="Commander tax">
                +{tax}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** The badge shows only the art, so who painted it is said here (as Scryfall asks), with the copyright. */
function artCredit(card: Card): string {
  return card.artist ? `Art by ${card.artist} · © Wizards of the Coast` : '© Wizards of the Coast';
}
