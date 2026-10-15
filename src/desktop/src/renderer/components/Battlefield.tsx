import {
  MAX_TOKENS_IN_GROUP,
  NOTE,
  PERMANENT_COUNTERS,
  type GameState,
  type Permanent,
  type PlacedMarker,
  type SeatIndex,
  type Spot,
} from '@commander-brawl/domain';
import { cardImageUrl } from '@commander-brawl/infrastructure/browser';
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Icon } from '../icons/Icon';
import { isTyping } from '../keys';
import { CUSTOM_KIND_PREFIX, counterKindName } from '../names';
import { seatColorClass } from '../seatColors';
import { useCardsById } from '../useCards';
import { submitGameEvent } from '../useGame';
import { pictureNear, screenAt } from '../videoPoints';

/** Moving this far (in pixels) with the button down makes it a drag, not a click. */
const DRAG_DISTANCE = 6;
/** Room kept between what's shown and the edges, in pixels. */
const EDGE = 4;

/** A card (or group of tokens) or a counter or note, where it is on its player's video. */
type Item =
  | {
      readonly key: string;
      readonly kind: 'permanent';
      readonly seat: SeatIndex;
      readonly spot: Spot;
      readonly permanent: Permanent;
    }
  | {
      readonly key: string;
      readonly kind: 'marker';
      readonly seat: SeatIndex;
      readonly spot: Spot;
      readonly marker: PlacedMarker;
    };

interface BattlefieldProps {
  readonly game: GameState;
  /** Shown, not changed: when watching, or in the clean view. */
  readonly readOnly: boolean;
  onOpenCard(cardId: string): void;
  /** Puts a card from the battlefield in its player's graveyard. */
  onToGraveyard?: (seat: SeatIndex, permanent: Permanent) => void;
}

/**
 * What's on the players' battlefields, on their videos, the same for everyone: the cards that were identified (or
 * added) and the tokens, with their counters, and counters and notes put on the table. Drag one to where it is now;
 * click it for what can be done with it. Drawn over the seats, like pings.
 */
export function Battlefield({ game, readOnly, onOpenCard, onToGraveyard }: BattlefieldProps) {
  const ref = useRef<HTMLDivElement>(null);
  const items = itemsOf(game);
  const cards = useCardsById(
    items.flatMap((item) => (item.kind === 'permanent' && item.permanent.cardId ? [item.permanent.cardId] : [])),
  );
  const [placed, setPlaced] = useState<ReadonlyMap<string, { x: number; y: number }>>(new Map());
  const [dragging, setDragging] = useState<{ key: string; x: number; y: number } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const hovered = useRef<Item | null>(null);
  /** The labels and badges on screen, by key, to keep them on their player's picture. */
  const elements = useRef(new Map<string, HTMLElement>());
  const controls = useRef<HTMLDivElement>(null);
  const [controlsAt, setControlsAt] = useState<{ x: number; y: number } | null>(null);
  const latest = useRef({ items, open });
  useEffect(() => {
    latest.current = { items, open };
  });

  // Where each one is on screen depends on the videos' layout, which can change any time: placed every frame.
  const layoutKey = items.map((item) => `${item.key}@${item.spot.x},${item.spot.y}`).join('|');
  useEffect(() => {
    let frame = requestAnimationFrame(function place() {
      const layer = ref.current;
      if (layer) {
        const next = placeItems(layer, latest.current.items, elements.current);
        setPlaced((current) => (sameLayout(current, next) ? current : next));
        const openKey = latest.current.open;
        const label = openKey === null ? undefined : elements.current.get(openKey);
        const at = openKey === null ? undefined : next.get(openKey);
        const box = controls.current;
        const nextControls = label && at && box ? placeControls(layer, label, at, box) : null;
        setControlsAt((current) =>
          current &&
          nextControls &&
          Math.abs(current.x - nextControls.x) < 0.5 &&
          Math.abs(current.y - nextControls.y) < 0.5
            ? current
            : nextControls,
        );
      }
      // Nothing on any video: nothing to place until something is (the layout key changes then).
      if (latest.current.items.length > 0) frame = requestAnimationFrame(place);
    });
    return () => cancelAnimationFrame(frame);
  }, [layoutKey]);

  // Del (or Backspace) takes away the one the pointer is on; G puts a card in the graveyard.
  useEffect(() => {
    if (readOnly) return;
    const onKey = (event: KeyboardEvent) => {
      const item = hovered.current;
      if (!item || isTyping(event) || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        remove(item);
      } else if (event.key.toLowerCase() === 'g' && item.kind === 'permanent' && onToGraveyard) {
        event.preventDefault();
        onToGraveyard(item.seat, item.permanent);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [readOnly, onToGraveyard]);

  const startDrag = (event: ReactPointerEvent, item: Item) => {
    if (event.button !== 0) return;
    // Not a ping, an arrow or a close-up: this is about the item.
    event.stopPropagation();
    if (readOnly) return;
    event.preventDefault();
    const start = { x: event.clientX, y: event.clientY };
    const element = event.currentTarget as HTMLElement;
    let moved = false;
    const move = (e: PointerEvent) => {
      if (!moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) < DRAG_DISTANCE) return;
      moved = true;
      const origin = ref.current?.getBoundingClientRect();
      if (origin) setDragging({ key: item.key, x: e.clientX - origin.left, y: e.clientY - origin.top });
    };
    const end = (e: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      setDragging(null);
      if (e.type !== 'pointerup') return;
      if (!moved) {
        setOpen((current) => (current === item.key ? null : item.key));
        return;
      }
      drop(item, element, e.clientX, e.clientY);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };

  const openItem = readOnly || dragging?.key === open ? undefined : items.find((item) => item.key === open);
  return (
    <div ref={ref} className="battlefield-layer" data-testid="battlefield">
      {items.map((item) => {
        const at = dragging?.key === item.key ? dragging : placed.get(item.key);
        const isOpen = openItem?.key === item.key;
        // Placed (hidden) before it's known where: its size keeps it on the picture.
        const style = at ? { left: at.x, top: at.y } : { visibility: 'hidden' as const };
        return (
          <div
            key={item.key}
            className="board-item"
            style={style}
            ref={(element) => {
              if (element) elements.current.set(item.key, element);
              else elements.current.delete(item.key);
            }}
            onPointerDown={(event) => startDrag(event, item)}
            onPointerEnter={() => (hovered.current = item)}
            onPointerLeave={() => (hovered.current = null)}
            onKeyDown={(event: ReactKeyboardEvent) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setOpen((current) => (current === item.key ? null : item.key));
              }
            }}
          >
            {item.kind === 'permanent' ? (
              <PermanentLabel
                item={item}
                image={item.permanent.cardId ? (cards.get(item.permanent.cardId)?.image ?? null) : null}
                game={game}
                open={isOpen}
              />
            ) : (
              <MarkerBadge item={item} game={game} open={isOpen} readOnly={readOnly} />
            )}
          </div>
        );
      })}
      {openItem && (
        <div
          ref={controls}
          className="board-controls-place"
          style={controlsAt ? { left: controlsAt.x, top: controlsAt.y } : { visibility: 'hidden' }}
        >
          {openItem.kind === 'permanent' ? (
            <PermanentControls
              item={openItem}
              game={game}
              onOpenCard={onOpenCard}
              onToGraveyard={onToGraveyard}
              onClose={() => setOpen(null)}
            />
          ) : (
            <MarkerControls item={openItem} game={game} onClose={() => setOpen(null)} />
          )}
        </div>
      )}
    </div>
  );
}

function PermanentLabel({
  item,
  image,
  game,
  open,
}: {
  readonly item: Extract<Item, { kind: 'permanent' }>;
  readonly image: string | null;
  readonly game: GameState;
  readonly open: boolean;
}) {
  const { name, token, count, tapped, counters } = item.permanent;
  const allTapped = tapped > 0 && tapped === count;
  return (
    <div
      className={`board-card ${seatColorClass(item.seat)}${allTapped ? ' board-card-tapped' : ''}${open ? ' board-open' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={name}
      aria-expanded={open}
      title={`${name}: drag it to where it is, click for more. Del takes it away.`}
      data-testid="board-card"
      data-permanent-id={item.permanent.id}
      data-seat={item.seat}
    >
      {image ? (
        <img className="board-card-art" src={cardImageUrl(image, 'small')} alt="" draggable={false} />
      ) : (
        <Icon name={token ? 'token' : 'card-play'} className="board-card-icon" />
      )}
      <span className="board-card-name">
        {name}
        {token && count > 1 ? ` ×${count}` : ''}
        {tapped > 0 && count > 1 ? ` (${tapped} tapped)` : ''}
      </span>
      {Object.entries(counters).map(([kind, value]) => (
        <span key={kind} className="board-counter" title={`${counterKindName(game, kind)} counters`}>
          {value} {shortKind(game, kind)}
        </span>
      ))}
    </div>
  );
}

function PermanentControls({
  item,
  game,
  onOpenCard,
  onToGraveyard,
  onClose,
}: {
  readonly item: Extract<Item, { kind: 'permanent' }>;
  readonly game: GameState;
  onOpenCard(cardId: string): void;
  onToGraveyard: ((seat: SeatIndex, permanent: Permanent) => void) | undefined;
  onClose(): void;
}) {
  const { seat, permanent } = item;
  const { id, name, cardId, token, count, tapped, counters } = permanent;
  const tap = (amount: number) => submitGameEvent({ type: 'permanent-tapped', seat, id, amount });
  const counter = (kind: string, amount: number) =>
    submitGameEvent({ type: 'permanent-counter-changed', seat, id, kind, amount });
  return (
    <div
      className="board-controls"
      role="group"
      aria-label={`${name}: what to do`}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="board-controls-row">
        {cardId && (
          <button onClick={() => onOpenCard(cardId)} title="Its text and rulings">
            <Icon name="spell-book" /> Card
          </button>
        )}
        {count === 1 ? (
          <button aria-pressed={tapped === 1} onClick={() => tap(tapped === 1 ? -1 : 1)}>
            {tapped === 1 ? 'Untap' : 'Tap'}
          </button>
        ) : (
          <>
            <button aria-label={`Untap one ${name}`} disabled={tapped === 0} onClick={() => tap(-1)}>
              Untap 1
            </button>
            <button aria-label={`Tap one ${name}`} disabled={tapped >= count} onClick={() => tap(1)}>
              Tap 1
            </button>
          </>
        )}
        {token && (
          <span className="board-stepper">
            <button
              aria-label={`One ${name} token fewer`}
              disabled={count <= 1}
              onClick={() => submitGameEvent({ type: 'permanent-count-changed', seat, id, amount: -1 })}
            >
              −
            </button>
            <b>{count}</b>
            <button
              aria-label={`One more ${name} token`}
              disabled={count >= MAX_TOKENS_IN_GROUP}
              onClick={() => submitGameEvent({ type: 'permanent-count-changed', seat, id, amount: 1 })}
            >
              +
            </button>
          </span>
        )}
      </div>
      {Object.keys(counters).length > 0 && (
        <div className="board-controls-row">
          {Object.entries(counters).map(([kind, value]) => {
            const kindName = counterKindName(game, kind);
            return (
              <span key={kind} className="board-stepper">
                <button aria-label={`Remove a ${kindName} counter from ${name}`} onClick={() => counter(kind, -1)}>
                  −
                </button>
                <b>
                  {value} {kindName}
                </b>
                <button aria-label={`Add a ${kindName} counter to ${name}`} onClick={() => counter(kind, 1)}>
                  +
                </button>
              </span>
            );
          })}
        </div>
      )}
      <div className="board-controls-row">
        <select
          aria-label={`Put a counter on ${name}`}
          value=""
          onChange={(event) => event.target.value && counter(event.target.value, 1)}
        >
          <option value="">+ Counter</option>
          {counterKinds(game)
            .filter((k) => !(k.kind in counters))
            .map((k) => (
              <option key={k.kind} value={k.kind}>
                {k.name}
              </option>
            ))}
        </select>
        {onToGraveyard && (
          <button
            onClick={() => {
              onClose();
              onToGraveyard(seat, permanent);
            }}
            title="Into their graveyard, off the battlefield (G)"
          >
            <Icon name="graveyard" /> Graveyard
          </button>
        )}
        <button
          className="danger"
          aria-label={`Take ${name} away`}
          title="Off the battlefield (Del)"
          onClick={() => {
            onClose();
            submitGameEvent({ type: 'permanent-removed', seat, id });
          }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}

function MarkerBadge({
  item,
  game,
  open,
  readOnly,
}: {
  readonly item: Extract<Item, { kind: 'marker' }>;
  readonly game: GameState;
  readonly open: boolean;
  readonly readOnly: boolean;
}) {
  const { id, kind, count, text } = item.marker;
  const note = kind === NOTE;
  const label = note ? text : `${count} ${counterKindName(game, kind)}`;
  return (
    <div
      className={`board-marker ${seatColorClass(item.seat)}${note ? ' board-note' : ''}${open ? ' board-open' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={note ? `Note: ${text}` : `${label} counters`}
      aria-expanded={open}
      title={
        note
          ? `${text}: drag it to where it goes. Del takes it away.`
          : `${counterKindName(game, kind)} counters: the wheel counts up and down; drag onto a card to put them on it.`
      }
      data-testid="board-marker"
      data-marker-id={id}
      onWheel={
        readOnly || note
          ? undefined
          : (event) =>
              submitGameEvent({ type: 'marker-changed', seat: item.seat, id, amount: event.deltaY < 0 ? 1 : -1 })
      }
    >
      {note ? (
        text
      ) : (
        <>
          <b>{count}</b> {shortKind(game, kind)}
        </>
      )}
    </div>
  );
}

function MarkerControls({
  item,
  game,
  onClose,
}: {
  readonly item: Extract<Item, { kind: 'marker' }>;
  readonly game: GameState;
  onClose(): void;
}) {
  const { seat, marker } = item;
  const note = marker.kind === NOTE;
  const name = note ? `“${marker.text}”` : `${counterKindName(game, marker.kind)} counters`;
  return (
    <div
      className="board-controls"
      role="group"
      aria-label={`${name}: what to do`}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="board-controls-row">
        {!note && (
          <span className="board-stepper">
            <button
              aria-label={`One ${counterKindName(game, marker.kind)} counter fewer`}
              onClick={() => submitGameEvent({ type: 'marker-changed', seat, id: marker.id, amount: -1 })}
            >
              −
            </button>
            <b>{marker.count}</b>
            <button
              aria-label={`One more ${counterKindName(game, marker.kind)} counter`}
              onClick={() => submitGameEvent({ type: 'marker-changed', seat, id: marker.id, amount: 1 })}
            >
              +
            </button>
          </span>
        )}
        <button
          className="danger"
          aria-label={`Take ${name} away`}
          onClick={() => {
            onClose();
            submitGameEvent({ type: 'marker-removed', seat, id: marker.id });
          }}
        >
          ✕
        </button>
      </div>
      {!note && <p className="hint">Drag it onto a card to put the counters on that card.</p>}
    </div>
  );
}

/** Every item with a spot, seat by seat: cards and tokens under counters and notes. */
function itemsOf(game: GameState): Item[] {
  return game.seats.flatMap((seat, index) => {
    const s = index as SeatIndex;
    return [
      ...seat.permanents.flatMap((permanent): Item[] =>
        permanent.spot
          ? [{ key: `p:${permanent.id}`, kind: 'permanent', seat: s, spot: permanent.spot, permanent }]
          : [],
      ),
      ...seat.markers.map((marker): Item => ({
        key: `m:${marker.id}`,
        kind: 'marker',
        seat: s,
        spot: marker.spot,
        marker,
      })),
    ];
  });
}

/** The counters a card can have: the usual ones, and the table's own counters made for cards. */
export function counterKinds(game: GameState): { readonly kind: string; readonly name: string }[] {
  return [
    ...PERMANENT_COUNTERS.map((kind) => ({ kind: kind as string, name: kind as string })),
    ...game.customCounters
      .filter((counter) => counter.scope === 'card')
      .map((counter) => ({ kind: `${CUSTOM_KIND_PREFIX}${counter.id}`, name: counter.name })),
  ];
}

/** A counter's kind, short enough for a badge: "+1/+1", "loyal", a custom counter's name. */
function shortKind(game: GameState, kind: string): string {
  const name = counterKindName(game, kind);
  return name.length > 8 ? `${name.slice(0, 7)}…` : name;
}

function remove(item: Item): void {
  if (item.kind === 'permanent') submitGameEvent({ type: 'permanent-removed', seat: item.seat, id: item.permanent.id });
  else submitGameEvent({ type: 'marker-removed', seat: item.seat, id: item.marker.id });
}

/**
 * Where a dragged item was let go: onto a card of the same player (a counter goes on it), or a new spot on its
 * player's picture (the nearest one, if let go beside it).
 */
function drop(item: Item, element: HTMLElement, clientX: number, clientY: number): void {
  const under = document.elementsFromPoint(clientX, clientY).filter((e) => !element.contains(e));
  if (item.kind === 'marker' && item.marker.kind !== NOTE) {
    const card = under
      .map((e) => e.closest<HTMLElement>('[data-permanent-id]'))
      .find((e) => e && e.dataset.seat === String(item.seat));
    if (card?.dataset.permanentId) {
      submitGameEvent({ type: 'marker-attached', seat: item.seat, id: item.marker.id, to: card.dataset.permanentId });
      return;
    }
  }
  const video = document.querySelector<HTMLVideoElement>(`video.seat-video[data-seat="${item.seat}"]`);
  const spot = video && pictureNear(video, clientX, clientY);
  if (!spot) return;
  if (item.kind === 'permanent') {
    submitGameEvent({ type: 'permanent-moved', seat: item.seat, id: item.permanent.id, spot });
  } else {
    submitGameEvent({ type: 'marker-moved', seat: item.seat, id: item.marker.id, spot });
  }
}

/**
 * Where each item goes on screen, relative to the layer: the middle of it at its spot on its player's video, but all
 * of it on that player's picture (a card at the picture's edge isn't half off it).
 */
function placeItems(
  layer: HTMLElement,
  items: readonly Item[],
  elements: ReadonlyMap<string, HTMLElement>,
): Map<string, { x: number; y: number }> {
  const origin = layer.getBoundingClientRect();
  const videos = new Map<SeatIndex, { video: HTMLVideoElement; box: DOMRect } | null>();
  const placed = new Map<string, { x: number; y: number }>();
  for (const item of items) {
    if (!videos.has(item.seat)) {
      const video = layer.parentElement?.querySelector<HTMLVideoElement>(`video.seat-video[data-seat="${item.seat}"]`);
      videos.set(item.seat, video ? { video, box: video.getBoundingClientRect() } : null);
    }
    const seat = videos.get(item.seat);
    const at = seat ? screenAt(seat.video, item.spot, origin) : null;
    if (!seat || !at) continue;
    const element = elements.get(item.key);
    const halfWidth = (element?.offsetWidth ?? 0) / 2;
    const halfHeight = (element?.offsetHeight ?? 0) / 2;
    const left = seat.box.left - origin.left;
    const top = seat.box.top - origin.top;
    placed.set(item.key, {
      x: clampTo(at.x, left + halfWidth + EDGE, left + seat.box.width - halfWidth - EDGE),
      y: clampTo(at.y, top + halfHeight + EDGE, top + seat.box.height - halfHeight - EDGE),
    });
  }
  return placed;
}

/** What can be done with an item, under it (or over it, near the bottom), all of it inside the layer. */
function placeControls(
  layer: HTMLElement,
  label: HTMLElement,
  at: { x: number; y: number },
  box: HTMLElement,
): { x: number; y: number } {
  const width = box.offsetWidth;
  const height = box.offsetHeight;
  const below = at.y + label.offsetHeight / 2 + EDGE;
  const above = at.y - label.offsetHeight / 2 - EDGE - height;
  return {
    x: clampTo(at.x - width / 2, EDGE, layer.clientWidth - width - EDGE),
    y: below + height <= layer.clientHeight - EDGE ? below : Math.max(EDGE, above),
  };
}

/** Within min and max; the middle of them if there isn't room. */
function clampTo(value: number, min: number, max: number): number {
  return min > max ? (min + max) / 2 : Math.min(max, Math.max(min, value));
}

function sameLayout(
  a: ReadonlyMap<string, { x: number; y: number }>,
  b: ReadonlyMap<string, { x: number; y: number }>,
): boolean {
  if (a.size !== b.size) return false;
  for (const [key, at] of a) {
    const other = b.get(key);
    if (!other || Math.abs(other.x - at.x) >= 0.5 || Math.abs(other.y - at.y) >= 0.5) return false;
  }
  return true;
}
