import { orderCorners, type Point, type Quad } from '@commander-brawl/application';
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import { VideoView } from './VideoView';

interface CornerPickerProps {
  /** The camera as it is. */
  readonly track: MediaStreamTrack;
  readonly initial: Quad | null;
  onDone(corners: Quad): void;
  onCancel(): void;
}

/** Where the corners start, the first time: a rectangle in the middle of the picture, to drag onto the playmat. */
const START: Quad = [
  { x: 0.2, y: 0.2 },
  { x: 0.8, y: 0.2 },
  { x: 0.8, y: 0.8 },
  { x: 0.2, y: 0.8 },
];
const CORNER_NAMES = ['Top left corner', 'Top right corner', 'Bottom right corner', 'Bottom left corner'];
/** How far an arrow key moves a corner, as a share of the picture: a fine step, or a bigger one with Shift. */
const STEP = 0.002;
const BIG_STEP = 0.01;
/** The magnifier that shows the picture around the corner being dragged. */
const LOUPE_SIZE = 120;
const LOUPE_ZOOM = 3;

interface Drag {
  readonly corner: number;
  /** Where in the handle it was grabbed, so the corner doesn't jump to the pointer. */
  readonly offset: Point;
  /** The picture's size on screen, in pixels, for the magnifier. */
  readonly width: number;
  readonly height: number;
}

/**
 * Drag the four corners onto the corners of the playmat, on the camera picture. Pressing anywhere else moves the
 * nearest corner there. The picture is shown in its own shape, so a point on it is simply a share of its width
 * and height.
 */
export function CornerPicker({ track, initial, onDone, onCancel }: CornerPickerProps) {
  const [corners, setCorners] = useState<Quad>(initial ?? START);
  const [drag, setDrag] = useState<Drag | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const { width = 16, height = 9 } = track.getSettings();
  const ordered = orderCorners(corners);

  // The camera panel is long: bring the whole picture into view, so every corner can be reached.
  useEffect(() => {
    frame.current?.closest('.corner-picker')?.scrollIntoView({ block: 'nearest' });
  }, []);

  const move = (corner: number, point: Point) =>
    setCorners((all) => all.map((p, i) => (i === corner ? point : p)) as unknown as Quad);

  const pointAt = (event: PointerEvent): Point => {
    const box = frame.current!.getBoundingClientRect();
    return { x: clamp((event.clientX - box.left) / box.width), y: clamp((event.clientY - box.top) / box.height) };
  };

  const press = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const point = pointAt(event);
    const { width, height } = event.currentTarget.getBoundingClientRect();
    const handle = (event.target as HTMLElement).closest<HTMLElement>('[data-corner]');
    let corner: number;
    if (handle) {
      corner = Number(handle.dataset.corner);
      const at = corners[corner]!;
      setDrag({ corner, offset: { x: point.x - at.x, y: point.y - at.y }, width, height });
    } else {
      corner = nearest(corners, point, width, height);
      move(corner, point);
      setDrag({ corner, offset: { x: 0, y: 0 }, width, height });
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    // So the arrow keys move this corner next.
    event.currentTarget.querySelector<HTMLElement>(`[data-corner="${corner}"]`)?.focus({ preventScroll: true });
    event.preventDefault();
  };

  const follow = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const point = pointAt(event);
    move(drag.corner, { x: clamp(point.x - drag.offset.x), y: clamp(point.y - drag.offset.y) });
  };

  const nudge = (corner: number, event: KeyboardEvent) => {
    const step = event.shiftKey ? BIG_STEP : STEP;
    const [dx, dy] =
      { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key] ?? [];
    if (dx === undefined || dy === undefined) return;
    const at = corners[corner]!;
    move(corner, { x: clamp(at.x + dx), y: clamp(at.y + dy) });
    event.preventDefault();
  };

  const dragged = drag ? corners[drag.corner]! : null;
  return (
    <div className="corner-picker" data-testid="corner-picker">
      <p className="hint">
        Drag the corners onto the corners of your playmat, or click near one to move it there. Arrow keys fine-tune the
        one you last picked.
      </p>
      <div
        ref={frame}
        className={`corner-frame${drag ? ' corner-frame-dragging' : ''}`}
        style={{ aspectRatio: `${width} / ${height}`, width: `min(100%, calc(50vh * ${width / height}))` }}
        onPointerDown={press}
        onPointerMove={follow}
        onPointerUp={() => setDrag(null)}
        onPointerCancel={() => setDrag(null)}
        data-testid="corner-frame"
      >
        <VideoView track={track} className="corner-video" />
        <svg className="corner-outline" viewBox="0 0 100 100" preserveAspectRatio="none">
          <polygon
            points={ordered.map((p) => `${p.x * 100},${p.y * 100}`).join(' ')}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {corners.map((p, i) => (
          <button
            key={i}
            type="button"
            className="corner-handle"
            data-corner={i}
            aria-label={CORNER_NAMES[ordered.indexOf(p)]}
            style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
            onKeyDown={(event) => nudge(i, event)}
          />
        ))}
        {drag && dragged && <Loupe frame={frame} point={dragged} width={drag.width} height={drag.height} />}
      </div>
      <div className="row">
        <button className="primary" onClick={() => onDone(ordered)}>
          Straighten
        </button>
        <button onClick={() => setCorners(START)}>Start over</button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

interface LoupeProps {
  /** The picture's frame, with the camera's video in it. */
  readonly frame: RefObject<HTMLDivElement | null>;
  readonly point: Point;
  /** The picture's size on screen, in pixels. */
  readonly width: number;
  readonly height: number;
}

/**
 * The picture around a point, magnified. It's drawn from the video already on screen: playing the camera in a
 * second video, and removing that again, can leave the camera unable to take a still picture (for close-ups).
 */
function Loupe({ frame, point, width, height }: LoupeProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const at = useRef(point);
  useEffect(() => {
    at.current = point;
  }, [point]);

  useEffect(() => {
    let request = 0;
    const draw = () => {
      const video = frame.current?.querySelector('video');
      const context = canvas.current?.getContext('2d');
      if (video && context && video.videoWidth > 0) {
        const { x, y } = at.current;
        // The picture fills its frame, so a share of the frame is the same share of the video.
        const sourceWidth = (LOUPE_SIZE / LOUPE_ZOOM) * (video.videoWidth / width);
        const sourceHeight = (LOUPE_SIZE / LOUPE_ZOOM) * (video.videoHeight / height);
        const { width: w, height: h } = context.canvas;
        context.fillStyle = '#000';
        context.fillRect(0, 0, w, h);
        context.drawImage(
          video,
          x * video.videoWidth - sourceWidth / 2,
          y * video.videoHeight - sourceHeight / 2,
          sourceWidth,
          sourceHeight,
          0,
          0,
          w,
          h,
        );
      }
      request = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(request);
  }, [frame, width, height]);

  const pixels = Math.round(LOUPE_SIZE * (window.devicePixelRatio || 1));
  return (
    <div
      className="corner-loupe"
      style={{
        width: LOUPE_SIZE,
        height: LOUPE_SIZE,
        // Beside the corner, toward the middle of the picture, where it doesn't cover what's being lined up.
        left: point.x * width + (point.x < 0.5 ? 24 : -24 - LOUPE_SIZE),
        top: point.y * height + (point.y < 0.5 ? 24 : -24 - LOUPE_SIZE),
      }}
    >
      <canvas ref={canvas} width={pixels} height={pixels} />
    </div>
  );
}

/** The corner nearest a point, measured on screen (the picture is wider than tall). */
function nearest(corners: Quad, point: Point, width: number, height: number): number {
  const distance = (p: Point) => Math.hypot((p.x - point.x) * width, (p.y - point.y) * height);
  return corners.reduce((best, p, i) => (distance(p) < distance(corners[best]!) ? i : best), 0);
}

function clamp(share: number): number {
  return Math.min(1, Math.max(0, share));
}
