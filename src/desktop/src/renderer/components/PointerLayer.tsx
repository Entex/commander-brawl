import type { Pointer, TablePoint } from '@commander-brawl/application';
import { isSeatIndex, type SeatIndex } from '@commander-brawl/domain';
import type { PicturePoint } from '@commander-brawl/infrastructure/browser';
import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import type { Mark } from '../usePointers';
import { SEAT_COLORS } from '../seatColors';
import { pictureAt, pictureNear, screenAt } from '../videoPoints';

/** Moving this far (in pixels) with the button down makes it a drag (an arrow), not a click. */
const DRAG_DISTANCE = 10;

interface PointerLayerProps {
  readonly marks: readonly Mark[];
  /** The player pointed at something: right-click for a ping, a drag for an arrow. */
  onPoint(pointer: Pointer): void;
  /**
   * The player drew a rectangle around a card on a player's video (Ctrl+drag, or ⌘ on a Mac): its
   * corners on that seat's picture, and how that video is turned on screen.
   */
  onArea?: (seat: SeatIndex, from: PicturePoint, to: PicturePoint, rotation: 0 | 180) => void;
  /** You, while drawing an arrow. */
  readonly selfSeat: SeatIndex | null;
  readonly children: ReactNode;
}

/** A rectangle being drawn, relative to the seats. */
interface Area {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** A rectangle at least this share of the picture each way: a card, not a slip of the hand. */
const MIN_AREA = 0.02;

/**
 * The seats, with pings and arrows over their videos. Right-click a video to ping a spot on it; drag from one
 * spot to another (on the same video or another) to draw an arrow; Ctrl+drag around a card on a video to pick it
 * out. A plain click still goes to the video.
 */
export function PointerLayer({ marks, onPoint, onArea, selfSeat, children }: PointerLayerProps) {
  const ref = useRef<HTMLElement>(null);
  const [drag, setDrag] = useState<{ from: TablePoint; x: number; y: number } | null>(null);
  const [area, setArea] = useState<Area | null>(null);
  // After a drag that ended where it started, the browser still reports a click there. It isn't one.
  const swallowClick = useRef(false);

  const drawArea = (event: ReactPointerEvent, video: HTMLVideoElement, seat: SeatIndex) => {
    event.preventDefault();
    const start = { x: event.clientX, y: event.clientY };
    let dragging = false;
    const move = (e: PointerEvent) => {
      if (!dragging && Math.hypot(e.clientX - start.x, e.clientY - start.y) < DRAG_DISTANCE) return;
      dragging = true;
      const origin = ref.current?.getBoundingClientRect();
      if (!origin) return;
      setArea({
        left: Math.min(start.x, e.clientX) - origin.left,
        top: Math.min(start.y, e.clientY) - origin.top,
        width: Math.abs(e.clientX - start.x),
        height: Math.abs(e.clientY - start.y),
      });
    };
    const end = (e: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      setArea(null);
      if (!dragging) return;
      swallowClick.current = true;
      if (e.type !== 'pointerup') return;
      const from = pictureNear(video, start.x, start.y);
      const to = pictureNear(video, e.clientX, e.clientY);
      if (!from || !to || Math.abs(from.x - to.x) < MIN_AREA || Math.abs(from.y - to.y) < MIN_AREA) return;
      onArea?.(seat, from, to, video.dataset.rotation === '180' ? 180 : 0);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };

  const onPointerDown = (event: ReactPointerEvent) => {
    swallowClick.current = false;
    if (event.button !== 0) return;
    if ((event.ctrlKey || event.metaKey) && onArea) {
      // A seat's video, with cards to pick out (not an empty seat).
      const video = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLVideoElement>('video.seat-video-look[data-seat]');
      const seat = Number(video?.dataset.seat);
      if (video && isSeatIndex(seat)) {
        drawArea(event, video, seat);
        return;
      }
    }
    const from = tablePointAt(event.clientX, event.clientY);
    if (!from) return;
    event.preventDefault();
    const start = { x: event.clientX, y: event.clientY };
    let dragging = false;
    const move = (e: PointerEvent) => {
      if (!dragging && Math.hypot(e.clientX - start.x, e.clientY - start.y) < DRAG_DISTANCE) return;
      dragging = true;
      setDrag({ from, x: e.clientX, y: e.clientY });
    };
    const end = (e: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      setDrag(null);
      if (!dragging) return;
      swallowClick.current = true;
      const to = e.type === 'pointerup' ? tablePointAt(e.clientX, e.clientY) : null;
      if (to) onPoint({ kind: 'arrow', from, to });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };

  const onContextMenu = (event: MouseEvent) => {
    const at = tablePointAt(event.clientX, event.clientY);
    if (!at) return;
    event.preventDefault();
    onPoint({ kind: 'ping', at });
  };

  const onClickCapture = (event: MouseEvent) => {
    if (!swallowClick.current) return;
    swallowClick.current = false;
    event.stopPropagation();
  };

  return (
    <main
      className="seats"
      ref={ref}
      onPointerDown={onPointerDown}
      onContextMenu={onContextMenu}
      onClickCapture={onClickCapture}
    >
      {children}
      <Marks container={ref} marks={marks} drag={drag} selfSeat={selfSeat} />
      {area && <div className="area-preview" style={area} data-testid="area-preview" />}
    </main>
  );
}

/** The seat video under a point on screen, and where on its picture. */
function tablePointAt(clientX: number, clientY: number): TablePoint | null {
  const video = document.elementFromPoint(clientX, clientY)?.closest<HTMLVideoElement>('video[data-seat]');
  const seat = Number(video?.dataset.seat);
  if (!video || !isSeatIndex(seat)) return null;
  const point = pictureAt(video, clientX, clientY);
  return point && { seat, ...point };
}

interface Placed {
  readonly key: string;
  readonly color: (typeof SEAT_COLORS)[number];
  readonly name: string;
  readonly from: { x: number; y: number };
  /** Null for a ping. */
  readonly to: { x: number; y: number } | null;
  readonly preview: boolean;
}

/**
 * Draws the marks over the videos. Where they go depends on the videos' layout, which can change any time
 * (a window resized, a video's size known), so they're placed again every frame while there are any.
 */
function Marks({
  container,
  marks,
  drag,
  selfSeat,
}: {
  readonly container: RefObject<HTMLElement | null>;
  readonly marks: readonly Mark[];
  readonly drag: { from: TablePoint; x: number; y: number } | null;
  readonly selfSeat: SeatIndex | null;
}) {
  const [placed, setPlaced] = useState<readonly Placed[]>([]);

  useEffect(() => {
    let frame = requestAnimationFrame(function place() {
      const next = container.current ? placeMarks(container.current, marks, drag, selfSeat) : [];
      setPlaced((current) => (sameLayout(current, next) ? current : next));
      if (marks.length > 0 || drag) frame = requestAnimationFrame(place);
    });
    return () => cancelAnimationFrame(frame);
  }, [container, marks, drag, selfSeat]);

  if (placed.length === 0) return null;
  return (
    <svg className="pointer-layer" data-testid="pointer-layer">
      <defs>
        {SEAT_COLORS.map((color, seat) => (
          <marker
            key={seat}
            id={`arrow-head-${seat}`}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" fill={color} />
          </marker>
        ))}
      </defs>
      {placed.map((mark) => (
        <g
          key={mark.key}
          className={mark.preview ? 'pointer-preview' : 'pointer-mark'}
          data-testid={mark.to ? 'arrow' : 'ping'}
        >
          {mark.to ? (
            <line
              x1={mark.from.x}
              y1={mark.from.y}
              x2={mark.to.x}
              y2={mark.to.y}
              stroke={mark.color}
              strokeWidth={5}
              strokeLinecap="round"
              markerEnd={`url(#arrow-head-${SEAT_COLORS.indexOf(mark.color)})`}
            />
          ) : (
            <>
              <circle className="ping-ring" cx={mark.from.x} cy={mark.from.y} r={22} stroke={mark.color} />
              <circle cx={mark.from.x} cy={mark.from.y} r={6} fill={mark.color} />
            </>
          )}
          {!mark.preview && (
            <text x={mark.from.x + 14} y={mark.from.y - 14} fill={mark.color} className="pointer-name">
              {mark.name}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

function placeMarks(
  container: HTMLElement,
  marks: readonly Mark[],
  drag: { from: TablePoint; x: number; y: number } | null,
  selfSeat: SeatIndex | null,
): Placed[] {
  const origin = container.getBoundingClientRect();
  const at = (point: TablePoint) => {
    const video = container.querySelector<HTMLVideoElement>(`video[data-seat="${point.seat}"]`);
    return video ? screenAt(video, point, origin) : null;
  };
  const placed: Placed[] = [];
  for (const mark of marks) {
    const color = SEAT_COLORS[mark.seat]!;
    const from = at(mark.pointer.kind === 'ping' ? mark.pointer.at : mark.pointer.from);
    const to = mark.pointer.kind === 'arrow' ? at(mark.pointer.to) : null;
    // A mark on a video that's gone (its player left) isn't shown.
    if (!from || (mark.pointer.kind === 'arrow' && !to)) continue;
    placed.push({ key: String(mark.id), color, name: mark.name, from, to, preview: false });
  }
  if (drag) {
    const from = at(drag.from);
    if (from) {
      placed.push({
        key: 'drag',
        color: SEAT_COLORS[selfSeat ?? 0]!,
        name: '',
        from,
        to: { x: drag.x - origin.left, y: drag.y - origin.top },
        preview: true,
      });
    }
  }
  return placed;
}

function sameLayout(a: readonly Placed[], b: readonly Placed[]): boolean {
  return (
    a.length === b.length &&
    a.every((m, i) => {
      const n = b[i]!;
      return (
        m.key === n.key &&
        Math.abs(m.from.x - n.from.x) < 0.5 &&
        Math.abs(m.from.y - n.from.y) < 0.5 &&
        (m.to === null) === (n.to === null) &&
        (!m.to || !n.to || (Math.abs(m.to.x - n.to.x) < 0.5 && Math.abs(m.to.y - n.to.y) < 0.5))
      );
    })
  );
}
