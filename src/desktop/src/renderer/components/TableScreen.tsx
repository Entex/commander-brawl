import {
  TableSession,
  undoneIds,
  type GameView,
  type LoggedEvent,
  type SeatView,
  type TableSessionState,
} from '@commander-brawl/application';
import { DEFAULT_ICE_SERVERS, WebRtcPeerLinkFactory } from '@commander-brawl/infrastructure/browser';
import { MAX_SEATS, STARTING_LIFE, isUndoable, type SeatIndex } from '@commander-brawl/domain';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { HostInfo, RendererConfig } from '../../shared/api';
import { IpcTableSignaling } from '../api';
import { describeEvent } from '../describeEvent';
import { cameraStatus, type CameraState } from '../useCamera';
import { useCloseUps } from '../useCloseUps';
import { usePointers } from '../usePointers';
import { submitGameEvent, useGame } from '../useGame';
import { CardsPanel } from './CardsPanel';
import { ComboWarnings } from './ComboWarnings';
import { CountersPanel } from './CountersPanel';
import { DecksPanel } from './DecksPanel';
import { PointerLayer } from './PointerLayer';
import { ClockPanel, TurnControls } from './Turn';
import { VariantsBar, VariantsPanel } from './Variants';
import { ResponseBanner, ResponseButton, useResponseCalls } from './ResponseCalls';
import { RollBanner, RollMenu } from './Rolls';
import { Rule0Panel } from './Rule0Panel';
import { SnapshotView } from './SnapshotView';
import { Spotlight } from './Spotlight';
import { LogPanel } from './LogPanel';
import { Menu } from './Menu';
import { EmptySeat, SeatTile } from './SeatTile';
import { TableCounters } from './TableCounters';

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
  const game = useGame();
  const [showStats, setShowStats] = useState(false);
  const [countersOpen, setCountersOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [cardsOpen, setCardsOpen] = useState(false);
  /** A card to show when the Cards panel opens, e.g. a commander clicked on a seat. */
  const [cardFocus, setCardFocus] = useState<{ readonly id: string; readonly at: number } | null>(null);
  const openCard = useCallback((id: string) => {
    setCardFocus({ id, at: Date.now() });
    setCardsOpen(true);
  }, []);
  const [decksOpen, setDecksOpen] = useState(false);
  const [rule0Open, setRule0Open] = useState(false);
  const [clockOpen, setClockOpen] = useState(false);
  const [variantsOpen, setVariantsOpen] = useState(false);
  const selfSeat = state.seats.find((s) => s.isSelf)?.player.seat ?? null;
  useShortcut('k', () => setCardsOpen(true));
  const undoTarget = useUndoTarget(game, state);
  const responseCalls = useResponseCalls(game);
  const { marks: pointerMarks, point } = usePointers(session);
  const responding = new Set(responseCalls.map((call) => call.by.seat));
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void session.setLocalTrack(camera.track);
  }, [session, camera.track]);

  const { closeUp, look, close: closeCloseUp } = useCloseUps(camera);

  const status = cameraStatus(camera);
  useEffect(() => session.setCameraStatus(status), [session, status]);

  const getStats = useCallback((memberId: string) => session.getStats(memberId), [session]);

  const copyInvite = async () => {
    if (!host) return;
    await navigator.clipboard.writeText(host.invite);
    setCopied(true);
    setTimeout(() => setCopied(false), 2_000);
  };

  const seats = arrangeSeats(state.seats, game?.state.turnOrder ?? null);
  const activeSeat = game?.state.activeSeat ?? null;

  return (
    <div className="table-screen">
      <header className="toolbar">
        <div className="toolbar-group">
          {game && <span className="hint">Game {game.state.number}</span>}
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
          <button
            disabled={!undoTarget}
            title={
              undoTarget && game ? `Undo “${describeEvent(undoTarget, state.seats, game.state)}” (Ctrl+Z)` : undefined
            }
            onClick={() => undoTarget && submitGameEvent({ type: 'undo', target: undoTarget.id })}
          >
            Undo
          </button>
          <button onClick={() => setCardsOpen(!cardsOpen)} aria-pressed={cardsOpen} title="Look up a card (Ctrl+K)">
            Cards
          </button>
          <button onClick={() => setLogOpen(!logOpen)} aria-pressed={logOpen} disabled={!game}>
            Log
          </button>
          <button onClick={() => setCountersOpen(true)} disabled={!game}>
            Counters
          </button>
          <Menu label="Menu">
            {(close) => (
              <>
                <NewGameButton
                  onConfirm={() => {
                    close();
                    submitGameEvent({ type: 'new-game', startingLife: STARTING_LIFE });
                  }}
                />
                <button
                  role="menuitem"
                  onClick={() => {
                    close();
                    setDecksOpen(true);
                  }}
                >
                  Decks
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    close();
                    setClockOpen(true);
                  }}
                  disabled={!game}
                >
                  Clock
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    close();
                    setVariantsOpen(true);
                  }}
                  disabled={!game}
                >
                  Planechase and Archenemy
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    close();
                    onOpenCamera();
                  }}
                >
                  Camera
                </button>
                <button role="menuitemcheckbox" aria-checked={showStats} onClick={() => setShowStats((v) => !v)}>
                  {showStats ? 'Hide stats' : 'Show stats'}
                </button>
                <button role="menuitem" className="danger" onClick={onLeave}>
                  {host ? 'Close table' : 'Leave'}
                </button>
              </>
            )}
          </Menu>
        </div>
      </header>

      {/* Its own row, so the turn and Pass turn are never squeezed out by the toolbar on a narrow window. */}
      {game && (
        <div className="status-bar">
          <ResponseButton />
          <RollMenu game={game.state} players={state.seats} />
          <button onClick={() => setRule0Open(true)}>Rule 0</button>
          <TurnControls game={game.state} players={state.seats} hostClockOffset={game.hostClockOffset} />
          <LastChange game={game} state={state} />
        </div>
      )}
      {game && <VariantsBar game={game} players={state.seats} />}
      {game && <ComboWarnings game={game.state} players={state.seats} />}
      <ConnectionBanner state={state} unconfirmed={game?.unconfirmed ?? 0} onLeave={onLeave} />
      {host && <ReachabilityHelp host={host} />}
      {host?.portChanged && (
        <p className="banner">
          The table couldn't get its old port back, so your friends need the new invite. Copy it and send it to them.
        </p>
      )}
      {game && <TableCounters game={game.state} />}
      {game && countersOpen && <CountersPanel game={game.state} onClose={() => setCountersOpen(false)} />}
      {host && <input className="invite-code" readOnly value={host.invite} data-testid="invite-code" />}

      {game && logOpen && <LogPanel game={game} players={state.seats} onClose={() => setLogOpen(false)} />}
      {cardsOpen && (
        <CardsPanel
          key={cardFocus?.at ?? 'search'}
          initialCardId={cardFocus?.id ?? null}
          onSpotlight={(card, reason) => {
            submitGameEvent({ type: 'card-shown', card: { id: card.id, name: card.name }, reason });
            setCardsOpen(false);
          }}
          onClose={() => {
            setCardsOpen(false);
            setCardFocus(null);
          }}
        />
      )}
      {decksOpen && (
        <DecksPanel
          seat={selfSeat}
          playing={selfSeat === null ? null : (game?.state.seats[selfSeat]?.deck ?? null)}
          onClose={() => setDecksOpen(false)}
        />
      )}

      {game && <Spotlight game={game} />}
      {closeUp && (
        <SnapshotView
          snapshot={closeUp}
          onOpenCard={(id) => {
            closeCloseUp();
            openCard(id);
          }}
          onTrack={(card, seat) => {
            closeCloseUp();
            const token = card.layout === 'token' || card.typeLine.startsWith('Token');
            submitGameEvent({
              type: 'permanent-added',
              seat,
              permanent: { id: crypto.randomUUID(), name: card.name, cardId: card.id, token, count: 1 },
            });
          }}
          onSearch={() => {
            closeCloseUp();
            setCardFocus(null);
            setCardsOpen(true);
          }}
          onClose={closeCloseUp}
        />
      )}
      {game && clockOpen && <ClockPanel clock={game.state.clock} onClose={() => setClockOpen(false)} />}
      {game && variantsOpen && (
        <VariantsPanel game={game.state} players={state.seats} onClose={() => setVariantsOpen(false)} />
      )}
      {game && rule0Open && (
        <Rule0Panel game={game.state} players={state.seats} selfSeat={selfSeat} onClose={() => setRule0Open(false)} />
      )}

      <PointerLayer marks={pointerMarks} onPoint={point} selfSeat={selfSeat}>
        <ResponseBanner calls={responseCalls} self={selfSeat} />
        <RollBanner game={game} players={state.seats} />
        {seats.map((seat, index) =>
          seat ? (
            <SeatTile
              key={seat.player.id}
              seat={seat}
              players={state.seats}
              game={game?.state ?? null}
              active={seat.player.seat === activeSeat}
              responding={responding.has(seat.player.seat)}
              hostClockOffset={game?.hostClockOffset ?? 0}
              showStats={showStats}
              getStats={getStats}
              onOpenCard={openCard}
              onLook={(crop, rotation) =>
                look(
                  seat.player.id,
                  seat.player.name,
                  seat.player.seat,
                  crop,
                  rotation,
                  game?.state.seats[seat.player.seat]?.deck ?? null,
                )
              }
            />
          ) : (
            <EmptySeat key={`empty-${index}`} index={index} />
          ),
        )}
      </PointerLayer>
    </div>
  );
}

function ReachabilityBadge({ host }: { readonly host: HostInfo }) {
  const { reachability } = host;
  if (reachability.kind === 'internet') {
    return (
      <span className="badge badge-ok" title="Friends can join over the internet">
        Open
      </span>
    );
  }
  return (
    <span className="badge badge-warn" title="Only players on your network can join">
      Local network only
    </span>
  );
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

/**
 * Seats in their table positions. Once there's a turn order, players sit clockwise in that order:
 * first top-left, then top-right, bottom-right, bottom-left.
 */
function arrangeSeats<T extends SeatView<MediaStreamTrack>>(
  players: readonly T[],
  turnOrder: readonly SeatIndex[] | null,
): (T | undefined)[] {
  const bySeat = (seat: number) => players.find((p) => p.player.seat === seat);
  if (!turnOrder) return Array.from({ length: MAX_SEATS }, (_, seat) => bySeat(seat));
  const inOrder = [
    ...turnOrder.map(bySeat).filter((p): p is T => p !== undefined),
    ...players.filter((p) => !turnOrder.includes(p.player.seat)),
  ];
  const slot = (i: number) => inOrder[i];
  return [slot(0), slot(1), slot(3), slot(2)];
}

/** Ctrl (or Cmd on a Mac) plus a key, anywhere in the window. */
function useShortcut(key: string, action: () => void): void {
  const actionRef = useRef(action);
  useEffect(() => {
    actionRef.current = action;
  }, [action]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === key) {
        event.preventDefault();
        actionRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [key]);
}

/** Your most recent change that hasn't been taken back yet. Ctrl+Z takes it back. */
function useUndoTarget(game: GameView | null, state: TableSessionState<MediaStreamTrack>): LoggedEvent | null {
  const self = state.seats.find((s) => s.isSelf)?.player.seat;
  const recent = game?.recent ?? [];
  const undone = undoneIds(recent);
  const target =
    [...recent].reverse().find((e) => e.by.seat === self && isUndoable(e.event) && !undone.has(e.id)) ?? null;

  const targetId = target?.id;
  useEffect(() => {
    if (!targetId) return;
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z' && !typing) {
        event.preventDefault();
        submitGameEvent({ type: 'undo', target: targetId });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [targetId]);

  return target;
}

function LastChange({
  game,
  state,
}: {
  readonly game: GameView | null;
  readonly state: TableSessionState<MediaStreamTrack>;
}) {
  // Things the app does by itself (like checking a deck) stay in the log, but aren't news here; neither are
  // phases, which show next to the turn.
  const last = game?.recent.findLast(
    (entry) => entry.event.type !== 'deck-analyzed' && entry.event.type !== 'phase-set',
  );
  if (!game || !last) return null;
  return (
    <span className="last-change" data-testid="last-change">
      {describeEvent(last, state.seats, game.state, (id) => game.recent.find((e) => e.id === id))}
    </span>
  );
}

/** Asks for a second click, so a stray click doesn't wipe the game. */
function NewGameButton({ onConfirm }: { onConfirm(): void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 3_000);
    return () => clearTimeout(timer);
  }, [armed]);
  return (
    <button
      role="menuitem"
      className={armed ? 'danger armed' : undefined}
      onClick={() => {
        setArmed(!armed);
        if (armed) onConfirm();
      }}
    >
      {armed ? 'Start a new game?' : 'New game'}
    </button>
  );
}

interface ConnectionBannerProps {
  readonly state: TableSessionState<MediaStreamTrack>;
  /** Changes made while the connection was down, still waiting to reach the host. */
  readonly unconfirmed: number;
  onLeave(): void;
}

function ConnectionBanner({ state, unconfirmed, onLeave }: ConnectionBannerProps) {
  const waiting =
    unconfirmed > 0 ? ` ${unconfirmed === 1 ? '1 change' : `${unconfirmed} changes`} will be sent when it's back.` : '';
  switch (state.connection) {
    case 'connected':
      return null;
    case 'connecting':
      return (
        <div className="banner">
          Connecting to the table…{state.connectionReason ? ` (${state.connectionReason})` : ''}
        </div>
      );
    case 'reconnecting':
      return <div className="banner">Reconnecting to the host… Video between players keeps running.{waiting}</div>;
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
