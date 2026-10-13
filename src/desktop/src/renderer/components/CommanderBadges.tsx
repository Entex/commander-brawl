import { commanderTax, type CommanderIndex, type GameState, type SeatIndex } from '@commander-brawl/domain';
import { cardImageUrl } from '@commander-brawl/infrastructure/browser';
import { useCardsByName } from '../useCards';
import { Symbols } from './CardText';

interface CommanderBadgesProps {
  readonly seat: SeatIndex;
  readonly game: GameState;
  onOpenCard(cardId: string): void;
}

const COLOR_ORDER = ['W', 'U', 'B', 'R', 'G'];

/** Each of the player's commanders: artwork, name, color identity and commander tax. Click for the card. */
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
        return (
          <button
            key={index}
            className="commander-badge"
            disabled={!card}
            title={card ? `Show ${card.name}` : name}
            onClick={() => card && onOpenCard(card.id)}
          >
            {card?.image && <img className="commander-art" src={cardImageUrl(card.image, 'art_crop')} alt="" />}
            <span className="commander-name">{card?.name.split(' // ')[0] ?? name}</span>
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
