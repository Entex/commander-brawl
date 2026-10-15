import {
  TableSession,
  cardInArea,
  inviteLink,
  undoneIds,
  type GameView,
  type LoggedEvent,
  type SeatView,
  type TableSessionState,
} from '@commander-brawl/application';
import { DEFAULT_ICE_SERVERS, WebRtcPeerLinkFactory } from '@commander-brawl/infrastructure/browser';
import {
  MAX_SEATS,
  STARTING_LIFE,
  isUndoable,
  type Card,
  type GameState,
  type SeatIndex,
  type Spot,
} from '@commander-brawl/domain';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { HostInfo, RendererConfig } from '../../shared/api';
import { IpcTableSignaling } from '../api';
import type { CardTarget } from '../cardTarget';
import { describeEvent } from '../describeEvent';
import { Icon } from '../icons/Icon';
import { cameraStatus, type CameraState } from '../useCamera';
import { isToken } from './AddToBattlefield';
import { Battlefield } from './Battlefield';
import { CLIP_SECONDS, useClips } from '../clips';
import { lookupCard, sureCard, useCardLookups, type CardLookup } from '../useCardLookups';
import { usePointers } from '../usePointers';
import { submitGameEvent, useGame } from '../useGame';
import { CardOutline } from './CardOutline';
import { CardRail } from './CardRail';
import { CardsPanel } from './CardsPanel';
import { ComboWarnings } from './ComboWarnings';
import { CountersPanel } from './CountersPanel';
import { DecksPanel } from './DecksPanel';
import { HistoryPanel } from './HistoryPanel';
import { PointerLayer } from './PointerLayer';
import { GameOverBanner, RecapView, useLiveRecap } from './RecapView';
import { ClockPanel, TurnControls } from './Turn';
import { VariantsBar, VariantsPanel } from './Variants';
import { CallsBanner, ResponseButton, respondingSeats } from './ResponseCalls';
import { RemindersButton } from './Reminders';
import { RollBanner, RollMenu } from './Rolls';
import { Rule0Panel } from './Rule0Panel';
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
  const [historyOpen, setHistoryOpen] = useState(false);
  const selfSeat = state.seats.find((s) => s.isSelf)?.player.seat ?? null;
  useShortcut('k', () => setCardsOpen(true));
  const undoTarget = useUndoTarget(game, state);
  const { marks: pointerMarks, point } = usePointers(session);
  const recap = useLiveRecap(game, state.seats);
  const clips = useClips();
  const responding = respondingSeats(game?.state ?? null);
  const [copied, setCopied] = useState(false);
  // Watching: you see everything and change nothing, and your camera isn't sent.
  const spectating = state.spectating;
  // The clean view for streaming (OBS): seats, life totals and commanders, none of the buttons.
  const [clean, setClean] = useState(false);
  const [enlargeActive, setEnlargeActive] = useEnlargeActive();
  const [boardShown, setBoardShown] = useBoardShown();
  const readOnly = spectating || clean;
  useEffect(() => {
    if (!clean) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setClean(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clean]);

  useEffect(() => {
    void session.setLocalTrack(spectating ? null : camera.track);
  }, [session, camera.track, spectating]);

  // Cards clicked on the players' videos (yours too): outlined there, and shown in a column beside the table.
  const { lookups, look, choose: chooseCard, markPlaced, remove: removeLookups } = useCardLookups(camera);
  const [seenOpen, setSeenOpen] = useState(false);
  /** The lookup the Cards panel is searching for (none of the guesses was it). */
  const [correcting, setCorrecting] = useState<number | null>(null);
  /** Looks up a card clicked, or drawn around, on a player's video: theirs, from their camera, or yours. */
  const lookAt = (seatIndex: SeatIndex, target: CardTarget, rotation: 0 | 180) => {
    const seat = state.seats.find((s) => s.player.seat === seatIndex);
    if (!seat) return;
    const deck = game?.state.seats[seatIndex]?.deck ?? null;
    look(seat.isSelf ? null : seat.player.id, seat.player.name, seatIndex, target, rotation, deck);
    setSeenOpen(true);
  };
  /** Puts a looked-up card on its player's battlefield, at the spot clicked (moving it there if it's there already). */
  const track = useCallback(
    (lookup: CardLookup, card: Card) => {
      const placed = placeOnBattlefield(game?.state ?? null, lookup, card);
      if (placed) markPlaced(lookup.id, placed);
    },
    [game, markPlaced],
  );
  // A card that's known for sure goes on the battlefield by itself: everyone sees it on the video.
  usePlaceSureCards(lookups, spectating, track);
  /** The player says which card it is. Already on the battlefield, it's that card there too. */
  const choose = (lookupId: number, card: Card) => {
    const lookup = lookups.find((l) => l.id === lookupId);
    chooseCard(lookupId, card);
    if (lookup?.placed && !spectating && lookupCard(lookup)?.id !== card.id) {
      submitGameEvent({
        type: 'permanent-identified',
        seat: lookup.seat,
        id: lookup.placed,
        name: card.name,
        cardId: card.id,
        token: isToken(card),
      });
    }
  };

  const status = cameraStatus(camera);
  useEffect(() => session.setCameraStatus(status), [session, status]);

  const getStats = useCallback((memberId: string) => session.getStats(memberId), [session]);

  const copyInvite = async () => {
    if (!host) return;
    await navigator.clipboard.writeText(inviteLink(host.invite));
    setCopied(true);
    setTimeout(() => setCopied(false), 2_000);
  };

  const seats = arrangeSeats(state.seats, game?.state.turnOrder ?? null);
  const activeSeat = game?.state.activeSeat ?? null;
  // The seat that gets most of the screen, if any: the active player's, with that setting on (not on your own turn).
  const focusedSeat = enlargeActive && activeSeat !== null && activeSeat !== selfSeat ? activeSeat : null;
  const focused = focusedSeat !== null && seats.some((seat) => seat?.player.seat === focusedSeat);
  const othersShown = seats.filter((seat) => seat && seat.player.seat !== focusedSeat).length;

  return (
    <div className={`table-screen${clean ? ' clean-view' : ''}`} data-testid="table-screen">
      {clean && (
        <button className="leave-clean-view" onClick={() => setClean(false)}>
          Leave the clean view (Esc)
        </button>
      )}
      <header className="toolbar">
        <div className="toolbar-group">
          <span className="brand">
            <Icon name="crossed-sabres" />
            {game ? `Game ${game.state.number}` : 'Commander Brawl'}
          </span>
          {spectating && (
            <span className="badge">
              <Icon name="all-seeing-eye" /> Watching
            </span>
          )}
          {state.spectators.length > 0 && !spectating && (
            <span className="hint" title={state.spectators.map((s) => s.name).join(', ')} data-testid="spectators">
              <Icon name="all-seeing-eye" /> {state.spectators.length} watching
            </span>
          )}
          {host && (
            <>
              <button onClick={() => void copyInvite()} data-testid="copy-invite">
                <Icon name="wax-seal" /> {copied ? 'Copied!' : 'Copy invite link'}
              </button>
              <ReachabilityBadge host={host} />
            </>
          )}
        </div>
        <div className="toolbar-group">
          {!spectating && (
            <button
              disabled={!undoTarget}
              title={
                undoTarget && game ? `Undo “${describeEvent(undoTarget, state.seats, game.state)}” (Ctrl+Z)` : undefined
              }
              onClick={() => undoTarget && submitGameEvent({ type: 'undo', target: undoTarget.id })}
            >
              <Icon name="anticlockwise-rotation" /> Undo
            </button>
          )}
          {lookups.length > 0 && (
            <button
              onClick={() => setSeenOpen(!seenOpen)}
              aria-pressed={seenOpen}
              title="The cards you clicked on the videos"
              data-testid="seen-toggle"
            >
              <Icon name="spyglass" /> Seen
            </button>
          )}
          <button
            onClick={() => {
              setCardsOpen(!cardsOpen);
              setCorrecting(null);
            }}
            aria-pressed={cardsOpen}
            title="Look up a card (Ctrl+K)"
          >
            <Icon name="spell-book" /> Cards
          </button>
          <button onClick={() => setLogOpen(!logOpen)} aria-pressed={logOpen} disabled={!game}>
            <Icon name="scroll-unfurled" /> Log
          </button>
          {!spectating && (
            <button onClick={() => setCountersOpen(true)} disabled={!game}>
              <Icon name="abacus" /> Counters
            </button>
          )}
          <Menu label="Menu" icon="gears">
            {(close) => (
              <>
                {!spectating && (
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
                      <Icon name="card-draw" /> Decks
                    </button>
                    <button
                      role="menuitem"
                      onClick={() => {
                        close();
                        setClockOpen(true);
                      }}
                      disabled={!game}
                    >
                      <Icon name="hourglass" /> Clock
                    </button>
                    <button
                      role="menuitem"
                      onClick={() => {
                        close();
                        setVariantsOpen(true);
                      }}
                      disabled={!game}
                    >
                      <Icon name="magic-portal" /> Planechase and Archenemy
                    </button>
                  </>
                )}
                <button
                  role="menuitem"
                  onClick={() => {
                    close();
                    setHistoryOpen(true);
                  }}
                >
                  <Icon name="tied-scroll" /> History
                </button>
                {!spectating && (
                  <button
                    role="menuitem"
                    onClick={() => {
                      close();
                      onOpenCamera();
                    }}
                  >
                    <Icon name="photo-camera" /> Camera
                  </button>
                )}
                <button
                  role="menuitem"
                  title="Just the seats, life totals and commanders, for streaming (OBS can capture the window)"
                  onClick={() => {
                    close();
                    setClean(true);
                  }}
                >
                  <Icon name="tv" /> Clean view for streaming
                </button>
                {clips.supported && (
                  <button
                    role="menuitemcheckbox"
                    aria-checked={clips.recording}
                    title={`Keeps the last ${CLIP_SECONDS} seconds of the table, to save when something great happens`}
                    onClick={() => {
                      close();
                      clips.toggle();
                    }}
                  >
                    <Icon name="clapperboard" /> Record clips
                  </button>
                )}
                <button
                  role="menuitemcheckbox"
                  aria-checked={boardShown}
                  title="The cards, tokens, counters and notes on each player's battlefield, on their video"
                  onClick={() => setBoardShown(!boardShown)}
                >
                  <Icon name="pin" /> Cards and counters on the videos
                </button>
                <button
                  role="menuitemcheckbox"
                  aria-checked={enlargeActive}
                  title="The player whose turn it is gets most of the screen (not on your own turn)"
                  onClick={() => setEnlargeActive(!enlargeActive)}
                >
                  <Icon name="expand" /> Enlarge the active player
                </button>
                <button role="menuitemcheckbox" aria-checked={showStats} onClick={() => setShowStats((v) => !v)}>
                  <Icon name="network-bars" /> {showStats ? 'Hide stats' : 'Show stats'}
                </button>
                <button role="menuitem" className="danger" onClick={onLeave}>
                  <Icon name="exit-door" /> {host ? 'Close table' : 'Leave'}
                </button>
              </>
            )}
          </Menu>
        </div>
      </header>

      {/* Its own row, so the turn and Pass turn are never squeezed out by the toolbar on a narrow window. */}
      {game && (
        <div className="status-bar">
          {!spectating && <ResponseButton seat={selfSeat} />}
          {clips.recording && (
            <button onClick={clips.save} title="Save the last half minute of the table as a video">
              <Icon name="clapperboard" /> Last {CLIP_SECONDS} s
            </button>
          )}
          {clips.note && (
            <span className="hint" data-testid="clip-note">
              {clips.note}
            </span>
          )}
          {recap.record && !recap.banner && !recap.viewing && (
            <button onClick={recap.view}>
              <Icon name="laurels-trophy" /> Recap
            </button>
          )}
          {!spectating && <RollMenu game={game.state} players={state.seats} />}
          {!spectating && <RemindersButton game={game.state} players={state.seats} selfSeat={selfSeat} />}
          <button onClick={() => setRule0Open(true)}>
            <Icon name="scales" /> Rule 0
          </button>
          <TurnControls
            game={game.state}
            players={state.seats}
            hostClockOffset={game.hostClockOffset}
            readOnly={spectating}
          />
          <LastChange game={game} state={state} />
        </div>
      )}
      {game && <VariantsBar game={game} players={state.seats} readOnly={readOnly} />}
      {game && <ComboWarnings game={game.state} players={state.seats} />}
      <ConnectionBanner state={state} unconfirmed={game?.unconfirmed ?? 0} onLeave={onLeave} />
      {host && <ReachabilityHelp host={host} />}
      {host?.portChanged && (
        <p className="banner">
          The table couldn't get its old port back, so your friends need the new invite. Copy it and send it to them.
        </p>
      )}
      {game && <TableCounters game={game.state} readOnly={readOnly} />}
      {game && countersOpen && <CountersPanel game={game.state} onClose={() => setCountersOpen(false)} />}
      {host && <input className="invite-code" readOnly value={inviteLink(host.invite)} data-testid="invite-code" />}

      {game && logOpen && <LogPanel game={game} players={state.seats} onClose={() => setLogOpen(false)} />}
      {cardsOpen && (
        <CardsPanel
          key={cardFocus?.at ?? 'search'}
          initialCardId={cardFocus?.id ?? null}
          onSpotlight={
            spectating
              ? undefined
              : (card, reason) => {
                  submitGameEvent({ type: 'card-shown', card: { id: card.id, name: card.name }, reason });
                  setCardsOpen(false);
                }
          }
          onPick={
            correcting === null
              ? undefined
              : (card) => {
                  choose(correcting, card);
                  setCorrecting(null);
                  setCardsOpen(false);
                }
          }
          onClose={() => {
            setCardsOpen(false);
            setCardFocus(null);
            setCorrecting(null);
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
      {game && clockOpen && <ClockPanel clock={game.state.clock} onClose={() => setClockOpen(false)} />}
      {historyOpen && <HistoryPanel onClose={() => setHistoryOpen(false)} />}
      {recap.record && recap.viewing && (
        <RecapView record={recap.record} number={recap.number ?? undefined} onClose={recap.close} />
      )}
      {game && variantsOpen && (
        <VariantsPanel game={game.state} players={state.seats} onClose={() => setVariantsOpen(false)} />
      )}
      {game && rule0Open && (
        <Rule0Panel game={game.state} players={state.seats} selfSeat={selfSeat} onClose={() => setRule0Open(false)} />
      )}

      <div className="table-body">
        <PointerLayer
          focusRows={focused ? Math.max(1, othersShown) : null}
          marks={pointerMarks}
          onPoint={spectating ? ignore : point}
          onArea={(seat, from, to, rotation) => lookAt(seat, cardInArea(from, to), rotation)}
          selfSeat={selfSeat}
        >
          {game && <CallsBanner game={game.state} players={state.seats} self={selfSeat} readOnly={readOnly} />}
          <RollBanner game={game} players={state.seats} />
          {recap.record && recap.banner && (
            <GameOverBanner record={recap.record} onView={recap.view} onClose={recap.close} />
          )}
          {seats.map((seat, index) =>
            seat ? (
              <SeatTile
                key={seat.player.id}
                seat={seat}
                players={state.seats}
                game={game?.state ?? null}
                active={seat.player.seat === activeSeat}
                focused={focused && seat.player.seat === focusedSeat}
                responding={responding.has(seat.player.seat)}
                hostClockOffset={game?.hostClockOffset ?? 0}
                readOnly={readOnly}
                showStats={showStats}
                getStats={getStats}
                onOpenCard={openCard}
                onLook={(target, rotation) => lookAt(seat.player.seat, target, rotation)}
                boardShown={boardShown}
                selfSeat={selfSeat}
              />
            ) : focused ? null : (
              <EmptySeat key={`empty-${index}`} index={index} />
            ),
          )}
          {game && boardShown && <Battlefield game={game.state} readOnly={readOnly} onOpenCard={openCard} />}
          <CardOutline key={lookups[0]?.id} lookup={lookups[0] ?? null} />
        </PointerLayer>
        {seenOpen && lookups.length > 0 && (
          <CardRail
            lookups={lookups}
            onOpenCard={(id) => {
              setCorrecting(null);
              openCard(id);
            }}
            onTrack={spectating ? undefined : track}
            onChoose={choose}
            onSearch={(id) => {
              setCorrecting(id);
              setCardFocus(null);
              setCardsOpen(true);
            }}
            onRemove={removeLookups}
            onClose={() => setSeenOpen(false)}
          />
        )}
      </div>
    </div>
  );
}

/** Spectators point at nothing: they send nothing. */
function ignore(): void {}

function ReachabilityBadge({ host }: { readonly host: HostInfo }) {
  const { reachability } = host;
  if (reachability.kind === 'internet') {
    return (
      <span className="badge badge-ok" title="Friends can join over the internet">
        <Icon name="open-gate" /> Open
      </span>
    );
  }
  if (reachability.kind === 'forward') {
    return (
      <span className="badge badge-warn" title="Friends outside your home can join if the port is forwarded">
        <Icon name="open-gate" /> Open if the port is forwarded
      </span>
    );
  }
  return (
    <span className="badge badge-warn" title="Only players on your network can join">
      <Icon name="padlock" /> Local network only
    </span>
  );
}

function ReachabilityHelp({ host }: { readonly host: HostInfo }) {
  const { reachability } = host;
  if (reachability.kind === 'internet') return null;
  if (reachability.kind === 'forward') {
    return (
      <p className="banner">
        {reachability.reason} If TCP port {reachability.port} is forwarded to this computer
        {reachability.localAddress ? ` (${reachability.localAddress})` : ''}, friends can join with the invite: it has
        your internet address ({reachability.address}). Your router doesn't let this computer check that itself.
      </p>
    );
  }
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

/**
 * Puts the card from a close-up on its player's battlefield, where it was clicked: added, or moved there if it's on
 * it already (one of a kind: Commander decks have one of each card, but basic lands and tokens). Returns the
 * permanent's id.
 */
function placeOnBattlefield(game: GameState | null, lookup: CardLookup, card: Card): string | null {
  if (!game) return null;
  const spot = centerOf(lookup);
  const seat = game.seats[lookup.seat];
  const same = isRepeatable(card) ? undefined : seat?.permanents.find((p) => p.cardId === card.id);
  if (same) {
    submitGameEvent({ type: 'permanent-moved', seat: lookup.seat, id: same.id, spot });
    return same.id;
  }
  const id = crypto.randomUUID();
  submitGameEvent({
    type: 'permanent-added',
    seat: lookup.seat,
    permanent: { id, name: card.name, cardId: card.id, token: isToken(card), count: 1, spot },
  });
  return id;
}

/** Cards a deck can have more than one of. */
function isRepeatable(card: Card): boolean {
  return isToken(card) || card.typeLine.includes('Basic') || /any number of cards named/i.test(card.oracleText);
}

/** The middle of the card clicked, on its player's picture. */
function centerOf(lookup: CardLookup): Spot {
  const { outline, crop } = lookup.target;
  if (outline) {
    return {
      x: outline.reduce((sum, p) => sum + p.x, 0) / outline.length,
      y: outline.reduce((sum, p) => sum + p.y, 0) / outline.length,
    };
  }
  return { x: crop.x + crop.width / 2, y: crop.y + crop.height / 2 };
}

/** Once a looked-up card is known for sure, it's put on the battlefield; once for each look. Not when watching. */
function usePlaceSureCards(
  lookups: readonly CardLookup[],
  watching: boolean,
  place: (lookup: CardLookup, card: Card) => void,
): void {
  const done = useRef(new Set<number>());
  useEffect(() => {
    if (watching) return;
    for (const lookup of lookups) {
      if (lookup.placed !== null || done.current.has(lookup.id)) continue;
      const card = sureCard(lookup);
      if (!card) continue;
      done.current.add(lookup.id);
      place(lookup, card);
    }
  }, [lookups, watching, place]);
}

const BOARD_KEY = 'cb.board';

/** Whether the cards and counters on the battlefields show on the videos. Remembered; on at first. */
function useBoardShown(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => localStorage.getItem(BOARD_KEY) !== '0');
  const set = (next: boolean) => {
    localStorage.setItem(BOARD_KEY, next ? '1' : '0');
    setOn(next);
  };
  return [on, set];
}

const ENLARGE_ACTIVE_KEY = 'cb.enlargeActive';

/** Whether the active player's seat gets most of the screen. Remembered on this computer; off at first. */
function useEnlargeActive(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => localStorage.getItem(ENLARGE_ACTIVE_KEY) === '1');
  const set = (next: boolean) => {
    localStorage.setItem(ENLARGE_ACTIVE_KEY, next ? '1' : '0');
    setOn(next);
  };
  return [on, set];
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

/**
 * Not news in the status bar: things the app does by itself (like checking a deck), phases (they show next to the
 * turn), and moving things around on the videos. They're in the log.
 */
const QUIET_EVENTS: ReadonlySet<string> = new Set(['deck-analyzed', 'phase-set', 'permanent-moved', 'marker-moved']);

function LastChange({
  game,
  state,
}: {
  readonly game: GameView | null;
  readonly state: TableSessionState<MediaStreamTrack>;
}) {
  // Things the app does by itself (like checking a deck) stay in the log, but aren't news here; neither are
  // phases, which show next to the turn.
  const last = game?.recent.findLast((entry) => !QUIET_EVENTS.has(entry.event.type));
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
      <Icon name="card-random" /> {armed ? 'Start a new game?' : 'New game'}
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
