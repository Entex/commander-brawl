import type { LinkStats, SeatView } from '@commander-brawl/application';
import {
  COMMANDER_DAMAGE_LIMIT,
  DUNGEONS,
  PLAYER_COUNTERS,
  POISON_LIMIT,
  bracketConcerns,
  comboThreats,
  commanderTax,
  counterValue,
  hasReachedLoss,
  isLastRoom,
  isOut,
  lossReason,
  startValue,
  type CommanderIndex,
  type CounterColor,
  type GameState,
  type SeatGameState,
  type SeatIndex,
} from '@commander-brawl/domain';
import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import { cardTargetAt, type CardTarget } from '../cardTarget';
import { pictureAt } from '../videoPoints';
import { Icon, type GameIconName } from '../icons/Icon';
import { COUNTER_ICONS, COUNTER_NAMES, commanderName, describeLoss, type Players } from '../names';
import { seatColorClass } from '../seatColors';
import { submitGameEvent } from '../useGame';
import { AddToBattlefield } from './AddToBattlefield';
import { CommanderBadges } from './CommanderBadges';
import { LifeCounter } from './LifeCounter';
import { SeatDetails } from './SeatDetails';
import { describeThreat } from './ComboWarnings';
import { permanentSummaries } from './Permanents';
import { SeatClock } from './Turn';
import { VideoView } from './VideoView';

interface SeatTileProps {
  readonly seat: SeatView<MediaStreamTrack>;
  readonly players: Players;
  /** Null until the game state has arrived. */
  readonly game: GameState | null;
  /** It's this player's turn. */
  readonly active: boolean;
  /** This seat gets most of the screen (see "Enlarge the active player"). */
  readonly focused?: boolean;
  /** This player just asked everyone to wait: they have a response. */
  readonly responding: boolean;
  /** See GameView.hostClockOffset. For a chess clock's time. */
  readonly hostClockOffset: number;
  /** Shown, not changed: when watching, or in the clean view for streaming. */
  readonly readOnly?: boolean;
  readonly showStats: boolean;
  getStats(memberId: string): Promise<LinkStats | null>;
  /** Shows a card in the Cards panel. */
  onOpenCard(cardId: string): void;
  /** A card clicked on this player's video (yours too): which card it is, from a sharp picture of it. */
  onLook(target: CardTarget, rotation: 0 | 180): void;
  /** The cards and counters with a spot show on the videos (not hidden): the seat doesn't list them again. */
  readonly boardShown?: boolean;
  readonly selfSeat?: SeatIndex | null;
  /** Opens this player's graveyard. */
  onOpenGraveyard?: () => void;
}

const LINK_TEXT: Partial<Record<SeatView<MediaStreamTrack>['link'], string>> = {
  new: 'Connecting…',
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  failed: 'Connection lost, retrying…',
};

export function SeatTile({
  seat,
  players,
  game,
  active,
  focused = false,
  responding,
  hostClockOffset,
  readOnly = false,
  showStats,
  getStats,
  onOpenCard,
  onLook,
  boardShown = false,
  selfSeat = null,
  onOpenGraveyard,
}: SeatTileProps) {
  const [rotation, setRotation] = useRotation(seat.player.name);
  const [detailsOpen, setDetailsOpen] = useState(false);
  /** Adding to their battlefield: where on their picture, and where the menu opens on the seat. */
  const [adding, setAdding] = useState<{
    readonly spot: { x: number; y: number } | null;
    readonly at: { x: number; y: number } | null;
  } | null>(null);
  // The chips let the pointer through to the video, so whether it's near them is worked out here.
  const chipsRef = useRef<HTMLDivElement>(null);
  const [nearChips, setNearChips] = useState(false);
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const box = chipsRef.current?.getBoundingClientRect();
    const near =
      !!box &&
      event.clientX >= box.left - CHIPS_NEAR &&
      event.clientX <= box.right + CHIPS_NEAR &&
      event.clientY >= box.top - CHIPS_NEAR &&
      event.clientY <= box.bottom + CHIPS_NEAR;
    if (near !== nearChips) setNearChips(near);
  };
  const stats = useLinkStats(seat, showStats, getStats);
  const status = LINK_TEXT[seat.link];
  const index = seat.player.seat;
  const state = game?.seats[index];

  return (
    <div
      className={`seat ${seatColorClass(index)}${active ? ' seat-active' : ''}${focused ? ' seat-focused' : ''}${
        responding ? ' seat-responding' : ''
      }`}
      data-focused={focused || undefined}
      data-testid={`seat-${seat.player.seat}`}
      data-link={seat.link}
      data-active={active}
      onPointerMove={onPointerMove}
      onPointerLeave={() => setNearChips(false)}
    >
      {seat.track ? (
        <VideoView
          track={seat.track}
          rotation={rotation}
          className="seat-video seat-video-look"
          testId="seat-video"
          seat={index}
          title="Click a card to see which card it is, or Ctrl+drag a box around it. Right-click to point at it; drag to draw an arrow. Alt+click to add a token, counter or note there"
          onClick={(event) => {
            if (event.altKey) {
              if (!game || readOnly) return;
              const spot = pictureAt(event.currentTarget, event.clientX, event.clientY);
              // Where it was clicked, but all of the menu on the seat.
              const box = event.currentTarget.parentElement!.getBoundingClientRect();
              const x = Math.max(4, Math.min(event.clientX - box.left, box.width - ADD_MENU_SIZE.width));
              const y = Math.max(4, Math.min(event.clientY - box.top, box.height - ADD_MENU_SIZE.height));
              if (spot) setAdding({ spot, at: { x, y } });
              return;
            }
            const target = cardTargetAt(event.currentTarget, event.clientX, event.clientY);
            if (target) onLook(target, rotation);
          }}
        />
      ) : (
        <div className="seat-empty">
          <Icon name="photo-camera" className="seat-empty-icon" />
          {seat.isSelf ? 'Set up your camera' : 'No camera yet'}
        </div>
      )}
      {seat.camera === 'reconnecting' && (
        <div className="seat-camera-note" data-testid={`camera-note-${index}`}>
          Camera reconnecting…
        </div>
      )}
      {seat.camera === 'off' && seat.track && (
        <div className="seat-camera-note" data-testid={`camera-note-${index}`}>
          Camera off
        </div>
      )}
      <div className="seat-info">
        <div className="seat-label">
          <span className="seat-name">{seat.isSelf && !readOnly ? `${seat.player.name} (you)` : seat.player.name}</span>
          {game && state && <CommanderBadges seat={index} game={game} onOpenCard={onOpenCard} />}
          {active && (
            <span className="badge badge-turn">
              <Icon name="knight-banner" />
              {seat.isSelf ? 'Your turn' : 'Their turn'}
            </span>
          )}
          {state?.bracket && <BracketBadge state={state} />}
          {game?.clock?.settings.kind === 'chess' && (
            <SeatClock clock={game.clock} seat={index} hostClockOffset={hostClockOffset} />
          )}
          {status && <span className="badge badge-warn">{status}</span>}
        </div>
        {game && state && (
          <SeatChips
            seat={seat}
            game={game}
            players={players}
            expanded={nearChips}
            chipsRef={chipsRef}
            boardShown={boardShown}
          />
        )}
      </div>
      {game && state && isOut(game, index) && (
        <div className="seat-out" data-testid={`out-${index}`}>
          <Icon name="tombstone" className="seat-out-icon" />
          <strong>Out</strong>
          <span>{outReason(game, index, players)}</span>
        </div>
      )}
      <div className="seat-actions">
        <button title="Turn the picture upside down" onClick={() => setRotation(rotation === 0 ? 180 : 0)}>
          <Icon name="cycle" /> Flip
        </button>
        {game && !readOnly && (
          <button
            aria-label={`Add to ${seat.player.name}'s battlefield`}
            title="Add a token, a counter, a note, a card or a reminder (or Alt+click a spot on the video)"
            onClick={() => setAdding(adding ? null : { spot: null, at: null })}
          >
            + Add
          </button>
        )}
        {game && !readOnly && (
          <button aria-label={`${seat.player.name}'s details`} onClick={() => setDetailsOpen(!detailsOpen)}>
            <Icon name="open-book" /> Details
          </button>
        )}
      </div>
      {game && adding && !readOnly && (
        <AddToBattlefield
          seat={index}
          whose={seat.isSelf ? 'your' : `${seat.player.name}'s`}
          game={game}
          players={players}
          selfSeat={selfSeat}
          spot={adding.spot}
          at={adding.at}
          onClose={() => setAdding(null)}
        />
      )}
      {state && (
        <LifeCounter
          seat={index}
          life={state.life}
          onChange={readOnly ? undefined : (amount) => submitGameEvent({ type: 'life-changed', seat: index, amount })}
        />
      )}
      {game && detailsOpen && !readOnly && (
        <SeatDetails
          seat={index}
          game={game}
          players={players}
          onOpenCard={onOpenCard}
          onOpenGraveyard={onOpenGraveyard}
          onClose={() => setDetailsOpen(false)}
        />
      )}
      {showStats && stats && <StatsLine stats={stats} />}
    </div>
  );
}

/** The numbers that matter right now, at a glance: counters, commander tax, commander damage taken. */
interface SeatChipsProps {
  readonly seat: SeatView<MediaStreamTrack>;
  readonly game: GameState;
  readonly players: Players;
  /** The pointer is near: every chip shows its words. */
  readonly expanded: boolean;
  readonly chipsRef: RefObject<HTMLDivElement | null>;
  /** Cards and tokens with a spot show on the video: only the others are listed. */
  readonly boardShown: boolean;
}

function SeatChips({ seat, game, players, expanded, chipsRef, boardShown }: SeatChipsProps) {
  const state = game.seats[seat.player.seat];
  if (!state) return null;
  const chips: Chip[] = [];

  const index = seat.player.seat;
  if (game.monarch === index) {
    chips.push({ key: 'monarch', label: 'Monarch', icon: 'crown', value: '', title: 'The monarch' });
  }
  if (game.initiative === index) {
    chips.push({ key: 'initiative', label: 'Initiative', icon: 'torch', value: '', title: 'Has the initiative' });
  }
  if (state.dungeon) {
    const dungeon = DUNGEONS[state.dungeon.dungeon];
    chips.push({
      key: 'dungeon',
      label: dungeon.name,
      icon: 'dungeon-gate',
      value: dungeon.rooms[state.dungeon.room]?.name ?? '',
      title: isLastRoom(state.dungeon) ? 'Dungeon completed' : 'In a dungeon',
    });
  }
  if (state.ringTempts > 0) {
    chips.push({
      key: 'ring',
      label: 'The Ring',
      icon: 'ring',
      value: `×${state.ringTempts}`,
      title: 'Times the Ring tempted them',
    });
  }
  if (state.citysBlessing) {
    chips.push({
      key: 'blessing',
      label: "City's blessing",
      icon: 'angel-wings',
      value: '',
      title: "Has the city's blessing",
    });
  }
  const threat = comboThreats(game).find((t) => t.seat === index);
  if (threat) {
    chips.push({
      key: 'combo',
      label: 'Combo',
      icon: 'skull-bolt',
      value: `${threat.present.length}/${threat.combo.cards.length}`,
      danger: threat.missing.length === 0,
      title: describeThreat(threat, players),
    });
  }
  const listed = boardShown ? state.permanents.filter((p) => p.spot === null) : state.permanents;
  const summaries = permanentSummaries(game, listed);
  for (const summary of summaries.slice(0, MAX_PERMANENT_CHIPS)) {
    chips.push({
      key: `permanent-${summary.key}`,
      label: summary.text,
      icon: 'card-play',
      value: '',
      title: summary.text,
    });
  }
  if (summaries.length > MAX_PERMANENT_CHIPS) {
    const more = summaries.length - MAX_PERMANENT_CHIPS;
    chips.push({ key: 'permanents-more', label: `+${more} more`, value: '', title: 'See Details' });
  }

  for (const counter of PLAYER_COUNTERS) {
    const value = state.counters[counter];
    if (value > 0) {
      chips.push({
        key: counter,
        label: COUNTER_NAMES[counter],
        icon: COUNTER_ICONS[counter],
        value: String(value),
        danger: counter === 'poison' && value >= POISON_LIMIT,
        title: COUNTER_NAMES[counter],
      });
    }
  }
  for (const counter of game.customCounters) {
    if (counter.scope !== 'player') continue;
    const value = counterValue(counter, state.custom);
    if (value !== startValue(counter)) {
      chips.push({
        key: `custom-${counter.id}`,
        label: counter.name,
        value: String(value),
        danger: hasReachedLoss(counter, value),
        color: counter.color,
        title: counter.name,
      });
    }
  }
  state.commanders.forEach((name, index) => {
    const tax = commanderTax(state, index as CommanderIndex);
    if (tax > 0 && !name) {
      const name = commanderName(game, players, seat.player.seat, index as CommanderIndex);
      chips.push({
        key: `tax-${index}`,
        label: `${name} tax`,
        icon: 'two-coins',
        value: `+${tax}`,
        title: 'Commander tax',
      });
    }
  });
  for (const opponent of players) {
    (game.seats[opponent.player.seat]?.commanders ?? []).forEach((_, index) => {
      const commander = index as CommanderIndex;
      const damage = state.commanderDamage[opponent.player.seat]?.[commander] ?? 0;
      if (damage > 0) {
        chips.push({
          key: `damage-${opponent.player.seat}-${commander}`,
          label: commanderName(game, players, opponent.player.seat, commander),
          icon: 'mailed-fist',
          value: String(damage),
          danger: damage >= COMMANDER_DAMAGE_LIMIT,
          title: 'Commander damage taken',
        });
      }
    });
  }

  if (chips.length === 0) return null;
  return (
    <div ref={chipsRef} className="seat-chips" data-testid={`chips-${seat.player.seat}`}>
      {chips.map((chip) => (
        <SeatChip key={chip.key} chip={chip} expanded={expanded} />
      ))}
    </div>
  );
}

interface Chip {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly icon?: GameIconName;
  readonly danger?: boolean;
  readonly color?: CounterColor;
  readonly title: string;
}

/** How long a chip shows its words when it appears or changes, before it's just its icon (and number). */
const CHIP_WORDS_MS = 3_000;
/** A value this short (a number, "+4", "2/3") stays beside the icon; a longer one (a dungeon room) goes too. */
const SHORT_VALUE = 5;

/**
 * One chip: its icon and words while it's new or the pointer is near, then just its icon (and a short value),
 * so it doesn't cover the video. Without an icon, it keeps its words.
 */
function SeatChip({ chip, expanded }: { readonly chip: Chip; readonly expanded: boolean }) {
  const shows = `${chip.label}|${chip.value}`;
  const [fresh, setFresh] = useState(true);
  const [shown, setShown] = useState(shows);
  if (shown !== shows) {
    setShown(shows);
    setFresh(true);
  }
  useEffect(() => {
    if (!fresh) return;
    const timer = setTimeout(() => setFresh(false), CHIP_WORDS_MS);
    return () => clearTimeout(timer);
  }, [fresh, shown]);
  const canCollapse = Boolean(chip.icon || chip.color);
  const collapsed = canCollapse && !fresh && !expanded;
  const longValue = chip.value.length > SHORT_VALUE;
  return (
    <span
      className={`chip chip-${chip.key}${chip.danger ? ' chip-danger' : ''}${collapsed ? ' chip-collapsed' : ''}`}
      title={chip.title}
    >
      {chip.color && <span className={`swatch color-${chip.color}`} />}
      {chip.icon && <Icon name={chip.icon} />}
      <span className="chip-words">{chip.label} </span>
      {chip.value && <b className={longValue ? 'chip-words' : undefined}>{chip.value}</b>}
    </span>
  );
}

/** About how big the menu for adding to a battlefield is, to keep it on the seat. */
const ADD_MENU_SIZE = { width: 256, height: 240 };

/** Cards and tokens listed on a seat; the rest are in the player's details. */
const MAX_PERMANENT_CHIPS = 6;
/** How near the chips (in pixels) the pointer brings their words back. */
const CHIPS_NEAR = 24;

function BracketBadge({ state }: { readonly state: SeatGameState }) {
  const concerns = state.bracket && state.deckAnalysis ? bracketConcerns(state.bracket, state.deckAnalysis) : [];
  return (
    <span
      className={`badge${concerns.length > 0 ? ' badge-warn' : ''}`}
      title={concerns.length > 0 ? concerns.join('\n') : `Bracket ${state.bracket}`}
      data-concerns={concerns.length}
    >
      <Icon name={concerns.length > 0 ? 'hazard-sign' : 'scales'} />
      Bracket {state.bracket}
    </span>
  );
}

function outReason(game: GameState, seat: SeatIndex, players: Players): string {
  const reason = lossReason(game, seat);
  return reason && game.seats[seat]?.outOverride === null ? describeLoss(reason, game, players) : 'Marked as out';
}

export function EmptySeat({ index }: { readonly index: number }) {
  return (
    <div className="seat seat-free" data-testid={`seat-${index}`}>
      <div className="seat-empty">
        <Icon name="meeple-group" className="seat-empty-icon" />
        Empty seat
      </div>
    </div>
  );
}

/**
 * The video between you and this player: what comes from them (↓) and what you send them (↑), and why what you
 * send is held back, if it is: no room on your connection, or your computer can't keep up.
 */
function StatsLine({ stats }: { readonly stats: LinkStats }) {
  const video = stats.inbound;
  const sent = stats.outbound;
  const held =
    sent?.limitation === 'bandwidth'
      ? ` · held back: not enough upload${stats.availableKbps ? ` (room for ${(stats.availableKbps / 1000).toFixed(1)} Mbps)` : ''}`
      : sent?.limitation === 'cpu'
        ? ' · held back: this computer is busy'
        : '';
  return (
    <div className="seat-stats" data-testid="seat-stats">
      <div>
        ↓{' '}
        {video
          ? `${video.width}×${video.height} · ${video.fps} fps · ${(video.kbps / 1000).toFixed(1)} Mbps`
          : 'no video'}
        {video && video.lossPercent > 0 ? ` · ${video.lossPercent}% lost` : ''}
        {stats.roundTripMs !== null ? ` · ${stats.roundTripMs} ms` : ''}
        {stats.route === 'relay' ? ' · relayed' : ''}
      </div>
      {sent && (
        <div>
          ↑ {sent.width}×{sent.height} · {sent.fps} fps · {(sent.kbps / 1000).toFixed(1)} Mbps{held}
        </div>
      )}
    </div>
  );
}

function useLinkStats(
  seat: SeatView<MediaStreamTrack>,
  enabled: boolean,
  getStats: (memberId: string) => Promise<LinkStats | null>,
): LinkStats | null {
  const [stats, setStats] = useState<LinkStats | null>(null);
  const memberId = seat.player.id;
  const active = enabled && !seat.isSelf;
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const poll = async () => {
      const next = await getStats(memberId);
      if (!cancelled) setStats(next);
    };
    void poll();
    const timer = setInterval(() => void poll(), 2_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [active, memberId, getStats]);
  return active ? stats : null;
}

/** Remembered per player name, since ids change when someone rejoins. */
function useRotation(playerName: string): [0 | 180, (rotation: 0 | 180) => void] {
  const key = `cb.rotation.${playerName}`;
  const [rotation, setRotationState] = useState<0 | 180>(() => (localStorage.getItem(key) === '180' ? 180 : 0));
  const setRotation = (value: 0 | 180) => {
    localStorage.setItem(key, String(value));
    setRotationState(value);
  };
  return [rotation, setRotation];
}
