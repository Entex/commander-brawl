import { orderCorners, type Point, type Quad } from '@commander-brawl/application';
import { useState, type MouseEvent } from 'react';
import { VideoView } from './VideoView';

interface CornerPickerProps {
  /** The camera as it is. */
  readonly track: MediaStreamTrack;
  readonly initial: Quad | null;
  onDone(corners: Quad): void;
  onCancel(): void;
}

const CORNER_NAMES = ['first', 'second', 'third', 'fourth'];

/**
 * Tap the four corners of the playmat on the camera picture, in any order. The picture is shown in its own
 * shape, so a point on it is simply a share of its width and height.
 */
export function CornerPicker({ track, initial, onDone, onCancel }: CornerPickerProps) {
  const [points, setPoints] = useState<readonly Point[]>(initial ?? []);
  const { width = 16, height = 9 } = track.getSettings();
  const ordered = points.length === 4 ? orderCorners(points) : null;

  const tap = (event: MouseEvent<HTMLElement>) => {
    if (points.length >= 4) return;
    const box = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width;
    const y = (event.clientY - box.top) / box.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    setPoints([...points, { x, y }]);
  };

  return (
    <div className="corner-picker" data-testid="corner-picker">
      <p className="hint">
        {points.length < 4
          ? `Click the ${CORNER_NAMES[points.length]} corner of your playmat (any order).`
          : 'This part of the table becomes the picture the others see, straight from above.'}
      </p>
      <div
        className="corner-frame"
        style={{ aspectRatio: `${width} / ${height}`, width: `min(100%, calc(50vh * ${width / height}))` }}
        onClick={tap}
        data-testid="corner-frame"
      >
        <VideoView track={track} className="corner-video" />
        <svg className="corner-outline" viewBox="0 0 100 100" preserveAspectRatio="none">
          {ordered && (
            <polygon
              points={ordered.map((p) => `${p.x * 100},${p.y * 100}`).join(' ')}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        {points.map((p, i) => (
          <span key={i} className="corner-dot" style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }} />
        ))}
      </div>
      <div className="row">
        <button className="primary" disabled={!ordered} onClick={() => ordered && onDone(ordered)}>
          Straighten
        </button>
        <button disabled={points.length === 0} onClick={() => setPoints([])}>
          Start over
        </button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
