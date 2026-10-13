/** A camera's view of a card on a table, drawn in a browser page for tests (made up: not a real card's picture). */

export interface CardPictureOptions {
  /** Size of the camera picture. */
  readonly width: number;
  readonly height: number;
  readonly name: string;
  readonly type: string;
  readonly text: readonly string[];
  /** The card's width in pixels, and its tilt (clockwise degrees). It sits in the middle of the picture. */
  readonly cardWidth: number;
  readonly angle: number;
}

/**
 * Draws the picture and returns it as a JPEG data URL. Runs in the page (pass it to page.evaluate), so it
 * uses nothing from outside itself.
 */
export function drawCardPicture(options: CardPictureOptions): string {
  const canvas = document.createElement('canvas');
  canvas.width = options.width;
  canvas.height = options.height;
  const g = canvas.getContext('2d')!;
  // A playmat.
  const mat = g.createLinearGradient(0, 0, options.width, options.height);
  mat.addColorStop(0, '#2f4a3a');
  mat.addColorStop(1, '#22303f');
  g.fillStyle = mat;
  g.fillRect(0, 0, options.width, options.height);

  const w = options.cardWidth;
  const h = (w * 88) / 63;
  g.translate(options.width / 2, options.height / 2);
  g.rotate((options.angle * Math.PI) / 180);
  g.translate(-w / 2, -h / 2);
  const box = (color: string, left: number, top: number, right: number, bottom: number) => {
    g.fillStyle = color;
    g.fillRect(left * w, top * h, (right - left) * w, (bottom - top) * h);
  };
  box('#151517', 0, 0, 1, 1);
  box('#3d6fb0', 0.035, 0.027, 0.965, 0.973);
  box('#dfe6ee', 0.06, 0.04, 0.94, 0.095);
  // Artwork: a sky and a few shapes.
  const sky = g.createLinearGradient(0, 0.112 * h, 0, 0.556 * h);
  sky.addColorStop(0, '#f2b45a');
  sky.addColorStop(1, '#6a2c70');
  g.fillStyle = sky;
  g.fillRect(0.082 * w, 0.112 * h, 0.836 * w, 0.444 * h);
  g.fillStyle = '#1d3557';
  g.beginPath();
  g.arc(0.35 * w, 0.4 * h, 0.12 * w, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#e63946';
  g.fillRect(0.55 * w, 0.25 * h, 0.2 * w, 0.2 * h);
  box('#dfe6ee', 0.06, 0.565, 0.94, 0.615);
  box('#eef0f2', 0.08, 0.63, 0.92, 0.92);

  g.fillStyle = '#111';
  g.textBaseline = 'middle';
  g.font = `bold ${0.062 * w}px serif`;
  g.fillText(options.name, 0.09 * w, 0.068 * h);
  g.font = `bold ${0.052 * w}px serif`;
  g.fillText(options.type, 0.09 * w, 0.59 * h);
  g.font = `${0.05 * w}px serif`;
  options.text.forEach((line, i) => g.fillText(line, 0.1 * w, (0.67 + i * 0.045) * h));
  return canvas.toDataURL('image/jpeg', 0.9);
}

export const RHYSTIC_STUDY = {
  name: 'Rhystic Study',
  type: 'Enchantment',
  text: ['Whenever an opponent casts a spell,', 'you may draw a card unless that', 'player pays {1}.'],
} as const;
