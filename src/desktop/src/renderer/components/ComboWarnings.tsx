import { comboThreats, type ComboThreat, type GameState } from '@commander-brawl/domain';
import { Icon } from '../icons/Icon';
import { seatName, type Players } from '../names';

const SHOWN = 4;

/**
 * Combos a player has most of on the battlefield, for everyone to see: "Alex has 2 of 3 pieces". Goes by the
 * cards kept track of at the table and the combos Commander Spellbook found in each deck.
 */
export function ComboWarnings({ game, players }: { readonly game: GameState; readonly players: Players }) {
  const threats = comboThreats(game);
  if (threats.length === 0) return null;
  return (
    <div className="combo-warnings" role="status" data-testid="combo-warnings">
      {threats.slice(0, SHOWN).map((threat) => (
        <p key={`${threat.seat}-${threat.combo.cards.join('+')}`}>
          <Icon name="skull-bolt" /> {describeThreat(threat, players)}
        </p>
      ))}
      {threats.length > SHOWN && <p className="hint">and {threats.length - SHOWN} more</p>}
    </div>
  );
}

export function describeThreat(threat: ComboThreat, players: Players): string {
  const who = seatName(players, threat.seat);
  const { cards, produces } = threat.combo;
  const what = produces.length > 0 ? ` (${produces.slice(0, 2).join(', ')})` : '';
  return threat.missing.length === 0
    ? `${who} has a whole combo: ${cards.join(' + ')}${what}`
    : `${who} has ${threat.present.length} of ${cards.length} pieces of ${cards.join(' + ')}${what}: missing ${threat.missing.join(', ')}`;
}
