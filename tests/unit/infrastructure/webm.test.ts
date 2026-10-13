import { lastSeconds, muxWebm } from '@commander-brawl/infrastructure/browser';
import { describe, expect, it } from 'vitest';

const frame = (seconds: number, key = false) => ({
  data: new Uint8Array([1, 2, 3]),
  timestamp: seconds * 1_000_000,
  key,
});

describe('keeping the last seconds', () => {
  const frames = [frame(0, true), frame(1), frame(2, true), frame(3), frame(4, true), frame(5), frame(6)];

  it('starts at the key frame at or before the cutoff, so the clip plays from its first frame', () => {
    // The last 3 seconds of 0–6: cutoff at 3, and the key frame before that is at 2.
    expect(lastSeconds(frames, 3).map((f) => f.timestamp / 1_000_000)).toEqual([2, 3, 4, 5, 6]);
    expect(lastSeconds(frames, 2).map((f) => f.timestamp / 1_000_000)).toEqual([4, 5, 6]);
  });

  it('keeps everything from the first key frame when there is less than asked for', () => {
    expect(lastSeconds(frames, 60)).toHaveLength(7);
    expect(lastSeconds([frame(0), frame(1)], 60)).toEqual([]);
  });
});

describe('writing WebM', () => {
  it('is a Matroska file with the frames in clusters, one per key frame', () => {
    const file = muxWebm([frame(0, true), frame(0.5), frame(1, true)], { width: 320, height: 180, codec: 'V_VP9' });
    expect([...file.subarray(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
    const text = new TextDecoder('latin1').decode(file);
    expect(text).toContain('webm');
    expect(text).toContain('V_VP9');
    // Two clusters (0x1F43B675), three blocks (0xA3, then the size, then track 1 as 0x81).
    expect(text.split('\u001fC¶u').length - 1).toBe(2);
  });

  it('starts at the first key frame', () => {
    const file = muxWebm([frame(0), frame(1, true)], { width: 2, height: 2, codec: 'V_VP8' });
    expect(new TextDecoder('latin1').decode(file).split('\u001fC¶u').length - 1).toBe(1);
  });
});
