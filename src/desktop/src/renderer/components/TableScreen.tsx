import { TableSession, type TableSessionState } from '@commander-brawl/application';
import { DEFAULT_ICE_SERVERS, WebRtcPeerLinkFactory } from '@commander-brawl/infrastructure/browser';
import { MAX_SEATS } from '@commander-brawl/domain';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { HostInfo, RendererConfig } from '../../shared/api';
import { IpcTableSignaling } from '../api';
import type { CameraState } from '../useCamera';
import { EmptySeat, SeatTile } from './SeatTile';

interface TableScreenProps {
  readonly config: RendererConfig;
  readonly host: HostInfo | null;
  readonly camera: CameraState;
  onOpenCamera(): void;
  onLeave(): void;
}

// Enough for a sharp 1080p picture of cards that barely move.
const MAX_BITRATE_BPS = 3_000_000;

export function TableScreen({ config, host, camera, onOpenCamera, onLeave }: TableScreenProps) {
  const session = useTableSession(config);
  const state = useSessionState(session);
  const [showStats, setShowStats] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void session.setLocalTrack(camera.track);
  }, [session, camera.track]);

  const getStats = useCallback((memberId: string) => session.getStats(memberId), [session]);

  const copyInvite = async () => {
    if (!host) return;
    await navigator.clipboard.writeText(host.invite);
    setCopied(true);
    setTimeout(() => setCopied(false), 2_000);
  };

  const seats = Array.from({ length: MAX_SEATS }, (_, index) => state.seats.find((s) => s.player.seat === index));

  return (
    <div className="table-screen">
      <header className="toolbar">
        <div className="toolbar-group">
          <strong>Commander Brawl</strong>
          {host && (
            <>
              <button onClick={() => void copyInvite()} data-testid="copy-invite">
                {copied ? 'Copied!' : 'Copy invite'}
              </button>
              <ReachabilityBadge host={host} />
            </>
          )}
        </div>
        <div className="toolbar-group">
          <button onClick={onOpenCamera}>Camera</button>
          <button onClick={() => setShowStats((v) => !v)} aria-pressed={showStats}>
            Stats
          </button>
          <button className="danger" onClick={onLeave}>
            {host ? 'Close table' : 'Leave'}
          </button>
        </div>
      </header>

      <ConnectionBanner state={state} onLeave={onLeave} />
      {host && <ReachabilityHelp host={host} />}
      {host && <input className="invite-code" readOnly value={host.invite} data-testid="invite-code" />}

      <main className="seats">
        {seats.map((seat, index) =>
          seat ? (
            <SeatTile key={seat.player.id} seat={seat} showStats={showStats} getStats={getStats} />
          ) : (
            <EmptySeat key={`empty-${index}`} index={index} />
          ),
        )}
      </main>
    </div>
  );
}

function ReachabilityBadge({ host }: { readonly host: HostInfo }) {
  const { reachability } = host;
  if (reachability.kind === 'internet') {
    return <span className="badge badge-ok">Friends can join over the internet</span>;
  }
  return <span className="badge badge-warn">Only players on your network can join</span>;
}

function ReachabilityHelp({ host }: { readonly host: HostInfo }) {
  const { reachability } = host;
  if (reachability.kind === 'internet') return null;
  return (
    <p className="banner">
      {reachability.reason} To let friends in, turn on UPnP in your router settings, or forward TCP port{' '}
      {reachability.port} to this computer, then host again.
    </p>
  );
}

function ConnectionBanner({ state, onLeave }: { readonly state: TableSessionState<MediaStreamTrack>; onLeave(): void }) {
  switch (state.connection) {
    case 'connected':
      return null;
    case 'connecting':
      return <div className="banner">Connecting to the table…{state.connectionReason ? ` (${state.connectionReason})` : ''}</div>;
    case 'reconnecting':
      return <div className="banner">Reconnecting to the host… Video between players keeps running.</div>;
    case 'closed':
      return (
        <div className="banner banner-error">
          {state.connectionReason ?? 'You left the table.'} <button onClick={onLeave}>Back</button>
        </div>
      );
  }
}

/** One session per visit to a table: the screen is mounted when you host or join, and unmounted when you leave. */
function useTableSession(config: RendererConfig): TableSession<MediaStreamTrack> {
  const [session] = useState(
    () =>
      new TableSession(
        new IpcTableSignaling(),
        new WebRtcPeerLinkFactory({
          iceServers: config.iceServers ? config.iceServers.map((server) => ({ ...server })) : DEFAULT_ICE_SERVERS,
          maxBitrateBps: MAX_BITRATE_BPS,
        }),
        {
          timers: {
            setTimeout: (callback, ms) => {
              const handle = window.setTimeout(callback, ms);
              return () => window.clearTimeout(handle);
            },
            now: () => Date.now(),
          },
          linkResetMs: 15_000,
        },
      ),
  );
  useEffect(() => {
    session.start();
    return () => session.dispose();
  }, [session]);
  return session;
}

function useSessionState(session: TableSession<MediaStreamTrack>): TableSessionState<MediaStreamTrack> {
  const subscribe = useCallback((onChange: () => void) => session.subscribe(onChange), [session]);
  return useSyncExternalStore(subscribe, () => session.getState());
}
