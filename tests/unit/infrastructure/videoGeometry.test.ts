import { pictureToScreen, screenToPicture, type VideoFit } from '@commander-brawl/infrastructure/browser';
import { describe, expect, it } from 'vitest';

// A 16:9 picture in a 400×400 element: bars above and below (the picture is 225 high, from y = 87.5).
const fit: VideoFit = { videoWidth: 1920, videoHeight: 1080, elementWidth: 400, elementHeight: 400, rotation: 0 };

describe('points on a video', () => {
  it('maps the screen to the picture, allowing for the bars', () => {
    expect(screenToPicture(fit, 200, 200)).toEqual({ x: 0.5, y: 0.5 });
    expect(screenToPicture(fit, 0, 87.5)).toEqual({ x: 0, y: 0 });
    expect(screenToPicture(fit, 200, 50)).toBeNull();
  });

  it('turns points around on a flipped video', () => {
    const flipped = { ...fit, rotation: 180 as const };
    // The top left of the screen box shows the picture's bottom right.
    expect(screenToPicture(flipped, 0, 312.5)).toEqual({ x: 1, y: 0 });
    expect(screenToPicture(flipped, 100, 150)).toEqual({ x: 0.75, y: expect.closeTo(0.7222, 3) });
  });

  it('puts a point back where it came from, either way up', () => {
    for (const rotation of [0, 180] as const) {
      const f = { ...fit, rotation };
      const point = screenToPicture(f, 123, 222)!;
      const back = pictureToScreen(f, point)!;
      expect(back.x).toBeCloseTo(123);
      expect(back.y).toBeCloseTo(222);
    }
  });

  it('has nothing to say before the video has a picture', () => {
    expect(screenToPicture({ ...fit, videoWidth: 0 }, 200, 200)).toBeNull();
    expect(pictureToScreen({ ...fit, videoHeight: 0 }, { x: 0.5, y: 0.5 })).toBeNull();
  });
});
