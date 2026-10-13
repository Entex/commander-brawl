import type { LinkStats, SeatView } from '@commander-brawl/application';
import { useEffect, useState } from 'react';
import { LifeCounter } from './LifeCounter';
import { VideoView } from './VideoView';

interface SeatTileProps {
  readonly seat: SeatView<MediaStreamTrack>;
  readonly showStats: boolean;
  /** Null until the game state has arrived. */
  readonly life: number | null;
  onLifeChange(amount: number): void;
  getStats(memberId: string): Promise<LinkStats | null>;
}

const LINK_TEXT: Partial<Record<SeatView<MediaStreamTrack>['link'], string>> = {
  new: 'Connecting…',
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  failed: 'Connection lost, retrying…',
};

export function SeatTile({ seat, showStats, life, onLifeChange, getStats }: SeatTileProps) {
  const [rotation, setRotation] = useRotation(seat.player.name);
  const stats = useLinkStats(seat, showStats, getStats);
  const status = LINK_TEXT[seat.link];

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
      <div className="seat-actions">
        <button title="Turn the picture upside down" onClick={() => setRotation(rotation === 0 ? 180 : 0)}>
          Flip
        </button>
      </div>
      {life !== null && <LifeCounter seat={seat.player.seat} life={life} onChange={onLifeChange} />}
      {showStats && stats && <StatsLine stats={stats} />}
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
