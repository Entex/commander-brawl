import { clampCrop, type CropRect, type LinkStats, type SeatView } from '@commander-brawl/application';
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
import { useEffect, useState } from 'react';
import { COUNTER_NAMES, commanderName, describeLoss, type Players } from '../names';
import { pictureAt } from '../videoPoints';
import { submitGameEvent } from '../useGame';
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
  /** This player just asked everyone to wait: they have a response. */
  readonly responding: boolean;
  /** See GameView.hostClockOffset. For a chess clock's time. */
  readonly hostClockOffset: number;
  readonly showStats: boolean;
  getStats(memberId: string): Promise<LinkStats | null>;
  /** Shows a card in the Cards panel. */
  onOpenCard(cardId: string): void;
  /** Asks this player's camera for a sharp picture of the part of their table that was clicked. */
  onLook(crop: CropRect, rotation: 0 | 180): void;
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
  responding,
  hostClockOffset,
  showStats,
  getStats,
  onOpenCard,
  onLook,
}: SeatTileProps) {
  const [rotation, setRotation] = useRotation(seat.player.name);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const stats = useLinkStats(seat, showStats, getStats);
  const status = LINK_TEXT[seat.link];
  const index = seat.player.seat;
  const state = game?.seats[index];

  return (
    <div
      className={`seat${active ? ' seat-active' : ''}${responding ? ' seat-responding' : ''}`}
      data-testid={`seat-${seat.player.seat}`}
      data-link={seat.link}
      data-active={active}
    >
      {seat.track ? (
        <VideoView
          track={seat.track}
          rotation={rotation}
          className={`seat-video${seat.isSelf ? '' : ' seat-video-look'}`}
          testId="seat-video"
          seat={index}
          title={
            seat.isSelf
              ? 'Right-click to point at something; drag to draw an arrow'
              : 'Click a card for a sharp picture of it. Right-click to point at it; drag to draw an arrow'
          }
          onClick={
            seat.isSelf
              ? undefined
              : (event) => {
                  const crop = cardCropAt(event.currentTarget, event.clientX, event.clientY);
                  if (crop) onLook(crop, rotation);
                }
          }
        />
      ) : (
        <div className="seat-empty">{seat.isSelf ? 'Set up your camera' : 'No camera yet'}</div>
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
          <span className="seat-name">{seat.isSelf ? `${seat.player.name} (you)` : seat.player.name}</span>
          {active && <span className="badge badge-turn">{seat.isSelf ? 'Your turn' : 'Their turn'}</span>}
          {state?.bracket && <BracketBadge state={state} />}
          {game?.clock?.settings.kind === 'chess' && (
            <SeatClock clock={game.clock} seat={index} hostClockOffset={hostClockOffset} />
          )}
          {status && <span className="badge badge-warn">{status}</span>}
        </div>
        {game && state && <CommanderBadges seat={index} game={game} onOpenCard={onOpenCard} />}
        {game && state && <SeatChips seat={seat} game={game} players={players} />}
      </div>
      {game && state && isOut(game, index) && (
        <div className="seat-out" data-testid={`out-${index}`}>
          <strong>Out</strong>
          <span>{outReason(game, index, players)}</span>
        </div>
      )}
      <div className="seat-actions">
        <button title="Turn the picture upside down" onClick={() => setRotation(rotation === 0 ? 180 : 0)}>
          Flip
        </button>
        {game && (
          <button aria-label={`${seat.player.name}'s details`} onClick={() => setDetailsOpen(!detailsOpen)}>
            Details
          </button>
        )}
      </div>
      {state && (
        <LifeCounter
          seat={index}
          life={state.life}
          onChange={(amount) => submitGameEvent({ type: 'life-changed', seat: index, amount })}
        />
      )}
      {game && detailsOpen && (
        <SeatDetails
          seat={index}
          game={game}
          players={players}
          onOpenCard={onOpenCard}
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
}

function SeatChips({ seat, game, players }: SeatChipsProps) {
  const state = game.seats[seat.player.seat];
  if (!state) return null;
  const chips: { key: string; label: string; value: string; danger?: boolean; color?: CounterColor; title: string }[] =
    [];

  const index = seat.player.seat;
  if (game.monarch === index) chips.push({ key: 'monarch', label: '👑 Monarch', value: '', title: 'The monarch' });
  if (game.initiative === index) {
    chips.push({ key: 'initiative', label: 'Initiative', value: '', title: 'Has the initiative' });
  }
  if (state.dungeon) {
    const dungeon = DUNGEONS[state.dungeon.dungeon];
    chips.push({
      key: 'dungeon',
      label: dungeon.name,
      value: dungeon.rooms[state.dungeon.room]?.name ?? '',
      title: isLastRoom(state.dungeon) ? 'Dungeon completed' : 'In a dungeon',
    });
  }
  if (state.ringTempts > 0) {
    chips.push({ key: 'ring', label: 'The Ring', value: `×${state.ringTempts}`, title: 'Times the Ring tempted them' });
  }
  if (state.citysBlessing) {
    chips.push({ key: 'blessing', label: "City's blessing", value: '', title: "Has the city's blessing" });
  }
  const threat = comboThreats(game).find((t) => t.seat === index);
  if (threat) {
    chips.push({
      key: 'combo',
      label: '⚠ Combo',
      value: `${threat.present.length}/${threat.combo.cards.length}`,
      danger: threat.missing.length === 0,
      title: describeThreat(threat, players),
    });
  }
  const summaries = permanentSummaries(game, state.permanents);
  for (const summary of summaries.slice(0, MAX_PERMANENT_CHIPS)) {
    chips.push({ key: `permanent-${summary.key}`, label: summary.text, value: '', title: summary.text });
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
      chips.push({ key: `tax-${index}`, label: `${name} tax`, value: `+${tax}`, title: 'Commander tax' });
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
          value: String(damage),
          danger: damage >= COMMANDER_DAMAGE_LIMIT,
          title: 'Commander damage taken',
        });
      }
    });
  }

  if (chips.length === 0) return null;
  return (
    <div className="seat-chips" data-testid={`chips-${seat.player.seat}`}>
      {chips.map((chip) => (
        <span key={chip.key} className={`chip${chip.danger ? ' chip-danger' : ''}`} title={chip.title}>
          {chip.color && <span className={`swatch color-${chip.color}`} />}
          {chip.label} <b>{chip.value}</b>
        </span>
      ))}
    </div>
  );
}

/** Cards and tokens listed on a seat; the rest are in the player's details. */
const MAX_PERMANENT_CHIPS = 6;

/** How big a card usually is in a camera picture, as a share of the picture's width. */
const CARD_WIDTH_SHARE = 0.2;
const CARD_ASPECT = 88 / 63;

/**
 * The card-sized part of the camera picture around a click on the video (a point on screen). The picture may
 * be fitted inside the element with bars beside it, and turned around; a click on the bars gives null.
 */
export function cardCropAt(video: HTMLVideoElement, clientX: number, clientY: number): CropRect | null {
  const point = pictureAt(video, clientX, clientY);
  if (!point) return null;
  const width = CARD_WIDTH_SHARE;
  const height = Math.min(1, width * (video.videoWidth / video.videoHeight) * CARD_ASPECT);
  return clampCrop({ x: point.x - width / 2, y: point.y - height / 2, width, height });
}

function BracketBadge({ state }: { readonly state: SeatGameState }) {
  const concerns = state.bracket && state.deckAnalysis ? bracketConcerns(state.bracket, state.deckAnalysis) : [];
  return (
    <span
      className={`badge${concerns.length > 0 ? ' badge-warn' : ''}`}
      title={concerns.length > 0 ? concerns.join('\n') : `Bracket ${state.bracket}`}
    >
      Bracket {state.bracket}
      {concerns.length > 0 ? ' ⚠' : ''}
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
      <div className="seat-empty">Empty seat</div>
    </div>
  );
}

function StatsLine({ stats }: { readonly stats: LinkStats }) {
  const video = stats.inbound;
  return (
    <div className="seat-stats">
      {video
        ? `${video.width}×${video.height} · ${video.fps} fps · ${(video.kbps / 1000).toFixed(1)} Mbps`
        : 'no video'}
      {video && video.lossPercent > 0 ? ` · ${video.lossPercent}% lost` : ''}
      {stats.roundTripMs !== null ? ` · ${stats.roundTripMs} ms` : ''}
      {stats.route === 'relay' ? ' · relayed' : ''}
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
