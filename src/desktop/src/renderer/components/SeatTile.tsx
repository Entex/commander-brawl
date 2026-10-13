import type { LinkStats, SeatView } from '@commander-brawl/application';
import { isOut, lossReason, type CommanderIndex, type GameState } from '@commander-brawl/domain';
import { useEffect, useState } from 'react';
import { commanderName, describeLoss, type Players } from '../names';
import { submitGameEvent } from '../useGame';
import { LifeCounter } from './LifeCounter';
import { SeatDetails } from './SeatDetails';
import { VideoView } from './VideoView';

interface SeatTileProps {
  readonly seat: SeatView<MediaStreamTrack>;
  readonly players: Players;
  /** Null until the game state has arrived. */
  readonly game: GameState | null;
  readonly showStats: boolean;
  getStats(memberId: string): Promise<LinkStats | null>;
}

const LINK_TEXT: Partial<Record<SeatView<MediaStreamTrack>['link'], string>> = {
  new: 'Connecting…',
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  failed: 'Connection lost, retrying…',
};

export function SeatTile({ seat, players, game, showStats, getStats }: SeatTileProps) {
  const [rotation, setRotation] = useRotation(seat.player.name);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const stats = useLinkStats(seat, showStats, getStats);
  const status = LINK_TEXT[seat.link];
  const index = seat.player.seat;
  const state = game?.seats[index];

  return (
    <div className="seat" data-testid={`seat-${seat.player.seat}`} data-link={seat.link}>
      {seat.track ? (
        <VideoView track={seat.track} rotation={rotation} className="seat-video" testId="seat-video" />
      ) : (
        <div className="seat-empty">{seat.isSelf ? 'Set up your camera' : 'No camera yet'}</div>
      )}
      <div className="seat-label">
        <span className="seat-name">{seat.isSelf ? `${seat.player.name} (you)` : seat.player.name}</span>
        {status && <span className="badge badge-warn">{status}</span>}
      </div>
      {game && state && <SeatChips seat={seat} game={game} players={players} />}
      {game && state && isOut(state) && (
        <div className="seat-out" data-testid={`out-${index}`}>
          <strong>Out</strong>
          <span>{lossReason(state) && state.outOverride === null ? describeLoss(lossReason(state)!, game, players) : 'Marked as out'}</span>
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
        <SeatDetails seat={index} game={game} players={players} onClose={() => setDetailsOpen(false)} />
      )}
      {showStats && stats && <StatsLine stats={stats} />}
    </div>
  );
}

/** Commander damage this player has taken, at a glance. */
function SeatChips({ seat, game, players }: { readonly seat: SeatView<MediaStreamTrack>; readonly game: GameState; readonly players: Players }) {
  const state = game.seats[seat.player.seat];
  if (!state) return null;
  const chips = players.flatMap((opponent) =>
    (game.seats[opponent.player.seat]?.commanders ?? []).flatMap((_, index) => {
      const commander = index as CommanderIndex;
      const damage = state.commanderDamage[opponent.player.seat]?.[commander] ?? 0;
      return damage > 0
        ? [{ key: `${opponent.player.seat}-${commander}`, label: commanderName(game, players, opponent.player.seat, commander), damage }]
        : [];
    }),
  );
  if (chips.length === 0) return null;
  return (
    <div className="seat-chips">
      {chips.map((chip) => (
        <span key={chip.key} className={`chip${chip.damage >= 21 ? ' chip-danger' : ''}`} title="Commander damage taken">
          {chip.label} <b>{chip.damage}</b>
        </span>
      ))}
    </div>
  );
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
      {video ? `${video.width}×${video.height} · ${video.fps} fps · ${(video.kbps / 1000).toFixed(1)} Mbps` : 'no video'}
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
