import { ClipRecorder } from '@commander-brawl/infrastructure/browser';
import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from './api';

const WIDTH = 1280;
const HEIGHT = 720;
export const CLIP_SECONDS = 30;

/**
 * Draws the table as it looks: each seat's video (turned the way you have it), with the player's name and life,
 * in a 2 by 2 grid. Read from the screen, so the clip shows what everyone saw.
 */
export function drawTable(g: OffscreenCanvasRenderingContext2D, width: number, height: number): void {
  g.fillStyle = '#101217';
  g.fillRect(0, 0, width, height);
  const seats = [...document.querySelectorAll<HTMLElement>('.seats > .seat[data-testid^="seat-"]')];
  const cellWidth = width / 2;
  const cellHeight = height / 2;
  seats.slice(0, 4).forEach((seat, i) => {
    const x = (i % 2) * cellWidth;
    const y = Math.floor(i / 2) * cellHeight;
    g.fillStyle = '#000';
    g.fillRect(x + 2, y + 2, cellWidth - 4, cellHeight - 4);
    const video = seat.querySelector('video');
    if (video && video.videoWidth > 0) {
      const scale = Math.min((cellWidth - 4) / video.videoWidth, (cellHeight - 4) / video.videoHeight);
      const w = video.videoWidth * scale;
      const h = video.videoHeight * scale;
      g.save();
      g.translate(x + cellWidth / 2, y + cellHeight / 2);
      if (video.dataset.rotation === '180') g.rotate(Math.PI);
      g.drawImage(video, -w / 2, -h / 2, w, h);
      g.restore();
    }
    const name = seat.querySelector('.seat-name')?.textContent ?? '';
    const life = seat.querySelector('[data-testid^="life-total-"]')?.textContent ?? '';
    g.font = 'bold 22px system-ui, sans-serif';
    g.textBaseline = 'top';
    outlined(g, name, x + 14, y + 12);
    if (life) {
      g.font = 'bold 40px system-ui, sans-serif';
      g.textBaseline = 'bottom';
      outlined(g, life, x + cellWidth / 2 - g.measureText(life).width / 2, y + cellHeight - 12);
    }
  });
}

function outlined(g: OffscreenCanvasRenderingContext2D, text: string, x: number, y: number): void {
  g.lineWidth = 4;
  g.strokeStyle = 'rgb(0 0 0 / 80%)';
  g.strokeText(text, x, y);
  g.fillStyle = '#fff';
  g.fillText(text, x, y);
}

export interface Clips {
  readonly supported: boolean;
  readonly recording: boolean;
  /** What happened with the last save, or why recording couldn't start. */
  readonly note: string | null;
  toggle(): void;
  save(): void;
}

/** The clip recorder: off until switched on, because recording costs CPU and memory. */
export function useClips(): Clips {
  const [on, setOn] = useState(false);
  const [recorder, setRecorder] = useState<ClipRecorder | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!on) return;
    let made: ClipRecorder | null = null;
    let active = true;
    void ClipRecorder.start({ width: WIDTH, height: HEIGHT, seconds: CLIP_SECONDS, draw: drawTable })
      .then((started) => {
        if (!active) return started.stop();
        made = started;
        setRecorder(started);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setNote(`Can't record: ${errorMessage(error)}`);
        setOn(false);
      });
    return () => {
      active = false;
      made?.stop();
      setRecorder(null);
    };
  }, [on]);

  const save = useCallback(() => {
    if (!recorder) return;
    setNote('Saving…');
    void recorder
      .save()
      .then((clip) => api.clips.save(clip))
      .then((saved) => setNote(saved ? 'Saved the clip.' : null))
      .catch((error: unknown) => setNote(`Couldn't save the clip: ${errorMessage(error)}`));
  }, [recorder]);

  return {
    supported: ClipRecorder.supported(),
    recording: on && recorder !== null,
    note,
    toggle: () => {
      setNote(null);
      setOn((v) => !v);
    },
    save,
  };
}
