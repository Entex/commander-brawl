import { videoToPhoto, widen } from '@commander-brawl/infrastructure/browser';
import { describe, expect, it } from 'vitest';

describe('mapping a part of the video onto a full photo', () => {
  it('uses the middle band of a taller photo (4:3 photo, 16:9 video)', () => {
    const mapped = videoToPhoto({ x: 0, y: 0, width: 1, height: 1 }, 4 / 3, 16 / 9);
    expect(mapped.x).toBe(0);
    expect(mapped.width).toBe(1);
    expect(mapped.y).toBeCloseTo(0.125);
    expect(mapped.height).toBeCloseTo(0.75);
  });

  it('uses the middle of a wider photo', () => {
    const mapped = videoToPhoto({ x: 0.5, y: 0, width: 0.5, height: 1 }, 16 / 9, 4 / 3);
    expect(mapped.x).toBeCloseTo(0.5);
    expect(mapped.width).toBeCloseTo(0.375);
  });

  it('adds a margin without leaving the picture', () => {
    expect(widen({ x: 0.1, y: 0.5, width: 0.2, height: 0.4 }, 0.5)).toEqual({ x: 0, y: 0.3, width: 0.4, height: 0.7 });
  });
});
