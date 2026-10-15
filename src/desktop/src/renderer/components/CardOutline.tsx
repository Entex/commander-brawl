import type { CropRect, Quad } from '@commander-brawl/application';
import { useEffect, useRef, useState } from 'react';
import { lookupCard, type CardLookup } from '../useCardLookups';
import { screenAt } from '../videoPoints';

/** How long the outline stays on the video once the card is known (or the lookup failed). */
const LINGER_MS = 5_000;

interface Placed {
  /** The outline's corners on screen, as SVG points. */
  readonly points: string;
  /** Above the middle of the outline's top, for the card's name. */
  readonly tag: { readonly x: number; readonly y: number };
}

/**
 * The card being looked up, outlined on its player's video: pulsing while their camera takes the picture and
 * it's read, then with the card's name, until it fades. Drawn over the seats, like pings.
 */
export function CardOutline({ lookup }: { readonly lookup: CardLookup | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState<Placed | null>(null);
  const [faded, setFaded] = useState<number | null>(null);
  const status = lookup?.step.status;
  const finished = status === 'done' || status === 'failed';
  const id = lookup?.id;

  useEffect(() => {
    if (id === undefined || !finished) return;
    const timer = setTimeout(() => setFaded(id), LINGER_MS);
    return () => clearTimeout(timer);
  }, [id, finished]);

  const shown = lookup?.target && faded !== lookup.id ? lookup : null;
  const seat = shown?.seat;
  const target = shown?.target;

  // Where it goes depends on the videos' layout, which can change any time: placed again every frame.
  useEffect(() => {
    if (seat === undefined || !target) return;
    const corners = target.outline ?? cornersOf(target.crop);
    let frame = requestAnimationFrame(function place() {
      const layer = ref.current;
      const video = layer?.parentElement?.querySelector<HTMLVideoElement>(`video[data-seat="${seat}"]`);
      const next = layer && video ? placeOutline(video, corners, layer.getBoundingClientRect()) : null;
      setPlaced((current) => (current?.points === next?.points ? current : next));
      frame = requestAnimationFrame(place);
    });
    return () => cancelAnimationFrame(frame);
  }, [seat, target]);

  if (!shown) return null;
  const card = lookupCard(shown);
  return (
    <div
      ref={ref}
      className={`card-outline-layer card-outline-${status}${finished ? ' card-outline-leaving' : ''}`}
      data-testid="card-outline"
      data-status={status}
    >
      {placed && (
        <svg className="card-outline">
          <polygon className="card-outline-glow" points={placed.points} />
          <polygon
            className={`card-outline-line${shown.target?.outline ? '' : ' card-outline-guess'}`}
            points={placed.points}
          />
        </svg>
      )}
      {placed && card && (
        <span className="card-outline-tag" style={{ left: placed.tag.x, top: placed.tag.y }}>
          {card.name}
        </span>
      )}
    </div>
  );
}

function placeOutline(video: HTMLVideoElement, corners: Quad, origin: DOMRect): Placed | null {
  const points = corners.map((corner) => screenAt(video, corner, origin));
  if (points.some((p) => p === null)) return null;
  const onScreen = points as { x: number; y: number }[];
  const top = [...onScreen].sort((a, b) => a.y - b.y).slice(0, 2);
  return {
    points: onScreen.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '),
    tag: { x: (top[0]!.x + top[1]!.x) / 2, y: Math.min(top[0]!.y, top[1]!.y) },
  };
}

function cornersOf(crop: CropRect): Quad {
  const right = crop.x + crop.width;
  const bottom = crop.y + crop.height;
  return [
    { x: crop.x, y: crop.y },
    { x: right, y: crop.y },
    { x: right, y: bottom },
    { x: crop.x, y: bottom },
  ];
}
